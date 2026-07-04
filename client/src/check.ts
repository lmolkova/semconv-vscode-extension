import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  commands,
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  ExtensionContext,
  languages,
  Location,
  OutputChannel,
  ProgressLocation,
  Range,
  SymbolInformation,
  Uri,
  window,
  workspace,
} from "vscode";

import { dockerArgs, findRegistries, resolveWeaverRunner, WeaverRunner } from "./weaver";

const CHECK_COMMAND = "semconv.checkRegistry";
// Bumped per run so a slower earlier run (save + command can overlap) doesn't clobber the
// diagnostics of a newer one when it finally resolves.
let generation = 0;
// Where the workspace root is bind-mounted for a Docker check; also the container CWD, so
// weaver discovers a repo-root `.weaver.toml` (and its policies) exactly as a native run would.
const MOUNT = "/workspace";

/**
 * Wires `weaver registry check` into a dedicated diagnostic collection: a palette command
 * that validates every registry in the workspace, and — when `semconv.check.enabled` — an
 * automatic re-check when a registry YAML file is saved. Weaver reports schema, cross-file
 * resolution, and Rego policy violations the in-process language server doesn't cover.
 */
export function registerWeaverCheck(context: ExtensionContext): void {
  const diagnostics = languages.createDiagnosticCollection("weaver");
  const output = window.createOutputChannel("OTel SemConv (Weaver)");
  context.subscriptions.push(
    diagnostics,
    output,
    commands.registerCommand(CHECK_COMMAND, () => runCheck(diagnostics, output, false)),
    workspace.onDidSaveTextDocument((doc) => {
      if (checkOnSave() && /\.ya?ml$/.test(doc.uri.fsPath))
        void runCheck(diagnostics, output, true);
    }),
  );
}

function checkOnSave(): boolean {
  return workspace.getConfiguration("semconv").get("check.enabled", true);
}

async function runCheck(
  diagnostics: DiagnosticCollection,
  output: OutputChannel,
  silent: boolean,
): Promise<void> {
  const root = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  const registries = await findRegistries();
  if (!registries.length) {
    if (!silent)
      void window.showWarningMessage(
        "No OpenTelemetry semantic-convention registry found in the workspace.",
      );
    return;
  }

  const runner = resolveWeaverRunner();
  if (!runner) {
    output.appendLine("weaver not found: no `semconv.weaver.path`, no `weaver` on PATH, no docker");
    if (!silent)
      void window.showWarningMessage(
        "Weaver not found. Set `semconv.weaver.path`, add `weaver` to PATH, or install Docker.",
      );
    return;
  }
  output.appendLine(
    `weaver: ${runner.docker ? "docker (otel/weaver image)" : runner.command} — ${registries.length} registr${registries.length === 1 ? "y" : "ies"}`,
  );

  const mine = ++generation;
  const collect = async (): Promise<CheckOutcome> => {
    const byUri = new Map<string, { uri: Uri; diags: Diagnostic[] }>();
    let failed = false;
    for (const dir of registries) {
      const results = await checkRegistry(runner, dir, output);
      if (results === undefined) {
        failed = true;
        continue;
      }
      for (const { uri, diagnostic } of results) {
        const entry = byUri.get(uri.toString()) ?? { uri, diags: [] };
        entry.diags.push(diagnostic);
        byUri.set(uri.toString(), entry);
      }
    }
    // A newer run started while this one was in flight — let it own the diagnostics.
    if (mine !== generation) return { superseded: true, failed, total: 0 };
    diagnostics.clear();
    for (const { uri, diags } of byUri.values()) diagnostics.set(uri, diags);
    return {
      failed,
      total: [...byUri.values()].reduce((n, e) => n + e.diags.length, 0),
    };
  };

  if (silent) {
    await collect();
    return;
  }
  const { failed, total, superseded } = await window.withProgress(
    { location: ProgressLocation.Window, title: "Checking semantic-convention registry…" },
    collect,
  );
  if (superseded) return;
  if (failed) {
    void window.showErrorMessage(
      "Weaver check failed to run — see the “OTel SemConv (Weaver)” output.",
    );
    return;
  }
  void window.showInformationMessage(
    total ? `Weaver reported ${total} issue${total === 1 ? "" : "s"}.` : "Weaver: no issues found.",
  );
}

interface CheckOutcome {
  failed: boolean;
  total: number;
  superseded?: boolean;
}

interface Located {
  uri: Uri;
  diagnostic: Diagnostic;
}

async function checkRegistry(
  runner: WeaverRunner,
  registryDir: string,
  output: OutputChannel,
): Promise<Located[] | undefined> {
  // Run from the nearest ancestor holding a `.weaver.toml` so weaver discovers it and its
  // (relative) policy paths — matching weaver's own upward-walk — even when the workspace was
  // opened at the registry itself and the config lives above it. No config: the registry is
  // enough. `base` is the container CWD / bind-mount root, so `-r` is written relative to it.
  const base = findConfigDir(registryDir) ?? registryDir;
  // Absolute `-r` is load-bearing: weaver 0.24 materializes an empty registry (so policies
  // never fire) when the registry path is relative.
  const rel = path.relative(base, registryDir) || ".";
  const check = [
    "registry",
    "check",
    "--v2",
    "-r",
    runner.docker ? path.posix.join(MOUNT, rel.split(path.sep).join("/")) : registryDir,
    "--diagnostic-format",
    "json",
    "--diagnostic-stdout",
  ];
  const args = runner.docker
    ? dockerArgs({
        mounts: [{ host: base, container: MOUNT, readOnly: true }],
        workdir: MOUNT,
        weaverArgs: check,
      })
    : check;

  output.appendLine(`$ ${runner.command} ${args.join(" ")}`);
  const { stdout, stderr } = await run(runner.command, args, base);
  // weaver exits non-zero when the registry has errors, still emitting the JSON report.
  // A parse failure means weaver itself errored (missing image, bad flags) — the check didn't
  // run, so signal failure (undefined) rather than an empty, misleading "no issues" result.
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    output.appendLine(`weaver produced no JSON report; stderr:\n${stderr.trim() || "(empty)"}`);
    return undefined;
  }
  if (!Array.isArray(report)) return undefined;
  const located = await Promise.all(
    report.map((entry) => toDiagnostic(entry, base, registryDir, runner.docker)),
  );
  return located.filter((d): d is Located => d !== undefined);
}

/** Nearest ancestor of `start` (inclusive) that holds a `.weaver.toml`, matching weaver's walk. */
function findConfigDir(start: string): string | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".weaver.toml"))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The registry file a directory-level finding (e.g. a policy violation) is pinned to. */
function registryManifest(dir: string): string {
  const named = ["manifest.yaml", "registry_manifest.yaml"]
    .map((n) => path.join(dir, n))
    .find((p) => fs.existsSync(p));
  return named ?? path.join(dir, "manifest.yaml");
}

function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      // execFile reports a spawn failure (e.g. docker not on PATH) via `err.message`, which
      // won't be on stderr — fold it in so the output channel explains the empty report.
      resolve({ stdout, stderr: stderr || (err ? String(err.message) : "") }),
    );
  });
}

interface PolicyViolation {
  message?: unknown;
  level?: unknown;
  signal_name?: unknown;
  context?: unknown;
}

async function toDiagnostic(
  entry: unknown,
  base: string,
  registryDir: string,
  docker: boolean,
): Promise<Located | undefined> {
  if (typeof entry !== "object" || entry === null) return undefined;
  const { diagnostic, error } = entry as { diagnostic?: Record<string, unknown>; error?: unknown };
  const policy = error as { type?: unknown; violation?: PolicyViolation } | undefined;
  const violation = policy?.type === "policy_violation" ? policy.violation : undefined;

  // Policy findings restate themselves verbosely in `diagnostic.message`; the finding's own
  // `message` is the clean, human-written one.
  const message =
    violation && typeof violation.message === "string"
      ? violation.message
      : typeof diagnostic?.message === "string"
        ? diagnostic.message
        : undefined;
  if (!message) return undefined;

  // Every `definition/2` file emits this warning — pure noise for an extension whose whole
  // purpose is definition/2 support.
  if (message.startsWith("File format `definition/2` is not yet stable")) return undefined;

  // Weaver provenances a policy finding only to the registry root, not the offending id. Our
  // own symbol index knows every id's exact range, so resolve the id the finding names; fall
  // back to the manifest when nothing resolves.
  if (violation) {
    const at = await locate(violation);
    const range = at?.range ?? new Range(0, 0, 0, 0);
    const uri = at?.uri ?? Uri.file(registryManifest(registryDir));
    return { uri, diagnostic: mkDiagnostic(message, range, policySeverity(violation.level)) };
  }

  const found = findProvenance(error);
  if (!found) return undefined;
  // Docker provenance is under the /workspace mount; a native run already reports host paths.
  const file =
    docker && found.startsWith(MOUNT)
      ? path.join(base, found.slice(MOUNT.length))
      : path.isAbsolute(found)
        ? found
        : path.join(base, found);
  const range = new Range(0, 0, 0, 0);
  return {
    uri: Uri.file(file),
    diagnostic: mkDiagnostic(message, range, severityOf(diagnostic?.severity)),
  };
}

function mkDiagnostic(message: string, range: Range, severity: DiagnosticSeverity): Diagnostic {
  const diag = new Diagnostic(range, message, severity);
  diag.source = "weaver";
  return diag;
}

/** Resolve the id a policy finding names to its definition, via the language server's index. */
async function locate(violation: PolicyViolation): Promise<Location | undefined> {
  for (const id of candidateIds(violation)) {
    const symbols = await commands.executeCommand<SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      id,
    );
    const hit = symbols?.find((s) => s.name === id);
    if (hit) return hit.location;
  }
  return undefined;
}

/** The ids a finding might be about: its `signal_name`, any string in `context`, quoted ids. */
function candidateIds(violation: PolicyViolation): string[] {
  const ids = new Set<string>();
  if (typeof violation.signal_name === "string") ids.add(violation.signal_name);
  if (violation.context && typeof violation.context === "object") {
    for (const v of Object.values(violation.context)) if (typeof v === "string") ids.add(v);
  }
  if (typeof violation.message === "string") {
    for (const [, id] of violation.message.matchAll(/[`'"]([A-Za-z0-9_.]{2,})[`'"]/g)) ids.add(id);
  }
  return [...ids];
}

function policySeverity(level: unknown): DiagnosticSeverity {
  if (level === "information") return DiagnosticSeverity.Information;
  if (level === "improvement") return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Error;
}

function severityOf(severity: unknown): DiagnosticSeverity {
  if (severity === "Warning") return DiagnosticSeverity.Warning;
  if (severity === "Advice") return DiagnosticSeverity.Information;
  return DiagnosticSeverity.Error;
}

/**
 * The weaver error union is heterogeneous, but the offending file — when known — is always
 * a `provenance`, either a bare path string or a `{ path }` object. Walk the tree for the
 * first one; diagnostics with no locatable file are dropped rather than pinned arbitrarily.
 */
function findProvenance(node: unknown): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findProvenance(item);
      if (hit) return hit;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  const prov = record.provenance;
  if (typeof prov === "string") return prov;
  if (prov && typeof prov === "object" && typeof (prov as { path?: unknown }).path === "string") {
    return (prov as { path: string }).path;
  }
  for (const value of Object.values(record)) {
    const hit = findProvenance(value);
    if (hit) return hit;
  }
  return undefined;
}
