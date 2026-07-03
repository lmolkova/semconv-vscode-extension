import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  commands,
  EventEmitter,
  ExtensionContext,
  extensions,
  lm,
  McpStdioServerDefinition,
  Uri,
  window,
  workspace,
} from "vscode";

// Injected by esbuild from scripts/weaver-version.mjs — the pinned otel/weaver tag,
// shared with the CI registry check and the vendored JSON schema.
declare const __WEAVER_VERSION__: string;

// Contribution id declared in package.json's `mcpServerDefinitionProviders`.
const PROVIDER_ID = "semconv-weaver";
const ADD_TO_CLAUDE_COMMAND = "semconv.addWeaverMcpToClaude";
// Claude Code reads project MCP servers from `.mcp.json` at the workspace root; it does
// not see servers we register through the VS Code provider API.
const CLAUDE_EXTENSION_ID = "anthropic.claude-code";
const CLAUDE_PROMPT_DISMISSED = "semconv.mcp.claudePromptDismissed";
const SERVER_KEY = "semconv-weaver";

// A registry root is the folder that holds one of these; weaver's `-r` points at it.
const MANIFEST_GLOB = "**/{manifest,registry_manifest}.yaml";

interface WeaverInvocation {
  command: string;
  args: string[];
  docker: boolean;
}

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
        return (await findRegistries())
          .map(weaverServer)
          .filter((s): s is McpStdioServerDefinition => s !== undefined);
      },
    }),
    commands.registerCommand(ADD_TO_CLAUDE_COMMAND, addWeaverMcpToClaude),
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

  void maybePromptClaude(context);
}

async function findRegistries(): Promise<string[]> {
  const manifests = await workspace.findFiles(MANIFEST_GLOB, "**/node_modules/**");
  return [...new Set(manifests.map((uri) => path.dirname(uri.fsPath)))];
}

function mcpEnabled(): boolean {
  return workspace.getConfiguration("semconv").get("mcp.enabled", true);
}

function weaverServer(registryDir: string): McpStdioServerDefinition | undefined {
  const inv = weaverInvocation(registryDir);
  if (!inv) return undefined;
  const label = `weaver: ${path.basename(registryDir)}${inv.docker ? " (docker)" : ""}`;
  return new McpStdioServerDefinition(label, inv.command, inv.args);
}

/** How to launch `weaver registry mcp` for a registry, or undefined when no weaver is available. */
function weaverInvocation(registryDir: string): WeaverInvocation | undefined {
  const weaver = resolveWeaver();
  if (weaver) {
    return { command: weaver, args: ["registry", "mcp", "--v2", "-r", registryDir], docker: false };
  }
  if (findOnPath("docker")) {
    // Fall back to the pinned image, mirroring scripts/check-registry.mjs. `-i` keeps
    // stdin open for the JSON-RPC stream; HOME is set because weaver caches under it.
    return {
      command: "docker",
      docker: true,
      args: [
        "run",
        "--rm",
        "-i",
        "-e",
        "HOME=/tmp",
        "-v",
        `${registryDir}:/registry:ro`,
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
 * Offers to wire the Weaver MCP server into `.mcp.json` when the Claude Code extension is
 * installed and this workspace has a registry Claude can't otherwise see. Shown once.
 */
async function maybePromptClaude(context: ExtensionContext): Promise<void> {
  if (!extensions.getExtension(CLAUDE_EXTENSION_ID)) return;
  if (context.globalState.get(CLAUDE_PROMPT_DISMISSED)) return;
  if (!mcpEnabled()) return;
  if (!(await findRegistries()).length) return;
  if (claudeConfigHasServer()) return;

  const add = "Add to .mcp.json";
  const never = "Don't show again";
  const choice = await window.showInformationMessage(
    "This workspace has an OpenTelemetry semantic-convention registry. Add the Weaver MCP server to .mcp.json so Claude Code can query it?",
    add,
    never,
  );
  if (choice === add) await addWeaverMcpToClaude();
  else if (choice === never) await context.globalState.update(CLAUDE_PROMPT_DISMISSED, true);
}

/** Merges a `weaver registry mcp` entry per registry into the workspace root `.mcp.json`. */
async function addWeaverMcpToClaude(): Promise<void> {
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  const registries = await findRegistries();
  if (!registries.length) {
    void window.showWarningMessage(
      "No OpenTelemetry semantic-convention registry found in the workspace.",
    );
    return;
  }

  const mcpPath = path.join(root, ".mcp.json");
  const config = readJson(mcpPath);
  const servers = (config.mcpServers ??= {});
  for (const dir of registries) {
    const inv = weaverInvocation(dir);
    if (!inv) {
      void window.showWarningMessage(
        "Weaver not found. Set `semconv.weaver.path`, add `weaver` to PATH, or install Docker.",
      );
      return;
    }
    // A local weaver runs from the project root, so keep `-r` project-relative for a
    // portable, committable config; the Docker mount still needs the absolute path.
    const args = inv.docker ? inv.args : [...inv.args.slice(0, -1), relativeRegistry(root, dir)];
    const name = registries.length > 1 ? `${SERVER_KEY}-${path.basename(dir)}` : SERVER_KEY;
    servers[name] = { command: inv.command, args };
  }
  fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n");

  const open = "Open .mcp.json";
  const choice = await window.showInformationMessage(
    "Added the Weaver MCP server to .mcp.json. Approve it when Claude Code prompts.",
    open,
  );
  if (choice === open) await window.showTextDocument(Uri.file(mcpPath));
}

function relativeRegistry(root: string, registryDir: string): string {
  const rel = path.relative(root, registryDir);
  return rel === "" ? "." : rel;
}

function claudeConfigHasServer(): boolean {
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return false;
  const servers = readJson(path.join(root, ".mcp.json")).mcpServers;
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
