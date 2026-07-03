import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  commands,
  env,
  EventEmitter,
  ExtensionContext,
  extensions,
  lm,
  McpStdioServerDefinition,
  QuickPickItem,
  Uri,
  window,
  workspace,
} from "vscode";

// Injected by esbuild from scripts/weaver-version.mjs — the pinned otel/weaver tag,
// shared with the CI registry check and the vendored JSON schema.
declare const __WEAVER_VERSION__: string;

// Contribution id declared in package.json's `mcpServerDefinitionProviders`.
const PROVIDER_ID = "semconv-weaver";
const ADD_SERVER_COMMAND = "semconv.addWeaverMcpServer";
const PROMPT_DISMISSED = "semconv.mcp.promptDismissed";
const SERVER_KEY = "semconv-weaver";

// A registry root is the folder that holds one of these; weaver's `-r` points at it.
const MANIFEST_GLOB = "**/{manifest,registry_manifest}.yaml";

/**
 * How to launch `weaver registry mcp`, resolved once (weaver setting → PATH → Docker) and
 * reused for every registry — `resolveWeaver` can exec `weaver --version`, so it must not
 * run per registry. `argsFor` fills in the registry path for a single server entry.
 */
interface WeaverRunner {
  command: string;
  docker: boolean;
  argsFor: (registry: string) => string[];
}

/**
 * An external agent whose MCP config the VS Code provider registration can't reach —
 * each reads its own file at the workspace root. `detect` decides whether that agent is
 * present (an installed extension, or the host app itself being that agent's IDE fork).
 */
interface McpTarget {
  id: string;
  label: string;
  file: string;
  detect: () => boolean;
}

const isHost = (name: string) => env.appName.toLowerCase().includes(name);

const TARGETS: McpTarget[] = [
  {
    id: "claude",
    label: "Claude Code — .mcp.json",
    file: ".mcp.json",
    detect: () => !!extensions.getExtension("anthropic.claude-code"),
  },
  {
    id: "antigravity",
    label: "Antigravity — .agents/mcp_config.json",
    file: path.join(".agents", "mcp_config.json"),
    detect: () => isHost("antigravity"),
  },
  {
    id: "cursor",
    label: "Cursor — .cursor/mcp.json",
    file: path.join(".cursor", "mcp.json"),
    detect: () => isHost("cursor"),
  },
];

/**
 * Registers `weaver registry mcp` as a stdio MCP server for every semconv registry in
 * the workspace, so Copilot agent mode can query the conventions in natural language.
 * Weaver is resolved from the `semconv.weaver.path` setting, then PATH, then Docker.
 */
export function registerWeaverMcp(context: ExtensionContext): void {
  const changed = new EventEmitter<void>();
  context.subscriptions.push(changed);

  context.subscriptions.push(
    lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: async () => {
        if (!mcpEnabled()) return [];
        const runner = resolveWeaverRunner();
        if (!runner) return [];
        return (await findRegistries()).map((dir) => weaverServer(dir, runner));
      },
    }),
    commands.registerCommand(ADD_SERVER_COMMAND, (targetId?: string) => {
      const target = targetId ? TARGETS.find((t) => t.id === targetId) : undefined;
      return target ? addServer(target) : pickTargetAndAdd();
    }),
  );

  const watcher = workspace.createFileSystemWatcher(MANIFEST_GLOB);
  const fire = () => changed.fire();
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(fire),
    watcher.onDidDelete(fire),
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("semconv.weaver.path") || e.affectsConfiguration("semconv.mcp"))
        fire();
    }),
  );

  void maybePromptAgents(context);
}

async function findRegistries(): Promise<string[]> {
  const manifests = await workspace.findFiles(MANIFEST_GLOB, "**/node_modules/**");
  return [...new Set(manifests.map((uri) => path.dirname(uri.fsPath)))];
}

function mcpEnabled(): boolean {
  return workspace.getConfiguration("semconv").get("mcp.enabled", true);
}

function weaverServer(registryDir: string, runner: WeaverRunner): McpStdioServerDefinition {
  const label = `weaver: ${path.basename(registryDir)}${runner.docker ? " (docker)" : ""}`;
  return new McpStdioServerDefinition(label, runner.command, runner.argsFor(registryDir));
}

/** Resolve how to launch `weaver registry mcp`, or undefined when no weaver is available. */
function resolveWeaverRunner(): WeaverRunner | undefined {
  const weaver = resolveWeaver();
  if (weaver) {
    return {
      command: weaver,
      docker: false,
      argsFor: (registry) => ["registry", "mcp", "--v2", "-r", registry],
    };
  }
  if (findOnPath("docker")) {
    // Fall back to the pinned image, mirroring scripts/check-registry.mjs. `-i` keeps
    // stdin open for the JSON-RPC stream; HOME is set because weaver caches under it.
    return {
      command: "docker",
      docker: true,
      argsFor: (registry) => [
        "run",
        "--rm",
        "-i",
        "-e",
        "HOME=/tmp",
        "-v",
        `${registry}:/registry:ro`,
        `otel/weaver:${__WEAVER_VERSION__}`,
        "registry",
        "mcp",
        "--v2",
        "-r",
        "/registry",
      ],
    };
  }
  return undefined;
}

/**
 * Offers to wire the Weaver MCP server into the config of any detected external agent
 * (Claude Code, Antigravity, Cursor) that can't see the VS Code provider registration.
 * Prompts whenever a workspace has a registry until "Don't show again" is chosen, which
 * suppresses it globally (globalState); dismissing without choosing re-prompts next time.
 */
async function maybePromptAgents(context: ExtensionContext): Promise<void> {
  if (context.globalState.get(PROMPT_DISMISSED)) return;
  if (!mcpEnabled()) return;
  if (!(await findRegistries()).length) return;

  const pending = TARGETS.filter((t) => t.detect() && !configHasServer(t));
  if (!pending.length) return;

  const single = pending.length === 1 ? pending[0] : undefined;
  const add = single ? `Add to ${path.basename(single.file)}` : "Add MCP server…";
  const never = "Don't show again";
  const choice = await window.showInformationMessage(
    "This workspace has an OpenTelemetry semantic-convention registry. Add the Weaver MCP server so your agent can query it?",
    add,
    never,
  );
  if (choice === add) await (single ? addServer(single) : pickTargetAndAdd(pending));
  else if (choice === never) await context.globalState.update(PROMPT_DISMISSED, true);
}

async function pickTargetAndAdd(targets: McpTarget[] = TARGETS): Promise<void> {
  const items: (QuickPickItem & { target: McpTarget })[] = targets.map((t) => ({
    label: t.label,
    description: t.detect() ? "detected" : undefined,
    target: t,
  }));
  const picked = await window.showQuickPick(items, {
    placeHolder: "Add the Weaver MCP server to which agent's config?",
  });
  if (picked) await addServer(picked.target);
}

/** Merges a `weaver registry mcp` entry per registry into the target agent's config file. */
async function addServer(target: McpTarget): Promise<void> {
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  const registries = await findRegistries();
  if (!registries.length) {
    void window.showWarningMessage(
      "No OpenTelemetry semantic-convention registry found in the workspace.",
    );
    return;
  }

  const runner = resolveWeaverRunner();
  if (!runner) {
    void window.showWarningMessage(
      "Weaver not found. Set `semconv.weaver.path`, add `weaver` to PATH, or install Docker.",
    );
    return;
  }

  const configPath = path.join(root, target.file);
  const config = readJson(configPath);
  const servers = (config.mcpServers ??= {});
  for (const dir of registries) {
    // A local weaver runs from the project root, so keep `-r` project-relative for a
    // portable, committable config; the Docker mount still needs the absolute path.
    const args = runner.argsFor(runner.docker ? dir : relativeRegistry(root, dir));
    const name = registries.length > 1 ? `${SERVER_KEY}-${path.basename(dir)}` : SERVER_KEY;
    servers[name] = { command: runner.command, args };
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  const open = `Open ${path.basename(target.file)}`;
  const choice = await window.showInformationMessage(
    `Added the Weaver MCP server to ${target.file}. Approve it when your agent prompts.`,
    open,
  );
  if (choice === open) await window.showTextDocument(Uri.file(configPath));
}

function relativeRegistry(root: string, registryDir: string): string {
  const rel = path.relative(root, registryDir);
  return rel === "" ? "." : rel;
}

function configHasServer(target: McpTarget): boolean {
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return false;
  const servers = readJson(path.join(root, target.file)).mcpServers;
  return !!servers && Object.keys(servers).some((k) => k.startsWith(SERVER_KEY));
}

function readJson(file: string): { mcpServers?: Record<string, unknown> } {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as { mcpServers?: Record<string, unknown> };
  } catch {
    return {};
  }
}

/**
 * The configured weaver path (trusted as-is), or a `weaver` on PATH — but only if it is
 * new enough to read the `definition/2` registries this extension targets. A PATH weaver
 * older than the pinned version is skipped so the caller falls back to the pinned image.
 */
function resolveWeaver(): string | undefined {
  const configured = workspace.getConfiguration("semconv").get<string>("weaver.path")?.trim();
  if (configured) return configured;
  const onPath = findOnPath("weaver");
  return onPath && atLeastPinned(weaverVersion(onPath)) ? onPath : undefined;
}

/** Parse the semver out of `weaver --version` (e.g. `weaver 0.24.2`); undefined if it fails. */
function weaverVersion(bin: string): string | undefined {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8" }).match(/\d+\.\d+\.\d+/)?.[0];
  } catch {
    return undefined;
  }
}

function atLeastPinned(version: string | undefined): boolean {
  if (!version) return false;
  const pinned = __WEAVER_VERSION__.replace(/^v/, "");
  const [a, b] = [version, pinned].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

function findOnPath(cmd: string): string | undefined {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
