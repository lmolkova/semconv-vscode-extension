import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { workspace } from "vscode";

// Injected by esbuild from scripts/weaver-version.mjs — the pinned otel/weaver tag,
// shared with the CI registry check and the vendored JSON schema.
declare const __WEAVER_VERSION__: string;

export const WEAVER_VERSION = __WEAVER_VERSION__;
const IMAGE = `otel/weaver:${__WEAVER_VERSION__}`;

// A registry root is the folder that holds one of these; weaver's `-r` points at it.
export const MANIFEST_GLOB = "**/{manifest,registry_manifest}.yaml";

/**
 * A resolved way to run weaver — a native binary or the pinned Docker image. Resolving
 * can exec `weaver --version`, so resolve once and reuse for every registry rather than
 * per invocation. Each feature builds its own subcommand args on top (see `dockerArgs`).
 */
export interface WeaverRunner {
  command: string;
  docker: boolean;
}

export interface DockerMount {
  host: string;
  container: string;
  readOnly?: boolean;
}

/** Resolve how to run weaver: `semconv.weaver.path` setting → PATH → Docker; undefined if none. */
export function resolveWeaverRunner(): WeaverRunner | undefined {
  const weaver = resolveWeaver();
  if (weaver) return { command: weaver, docker: false };
  if (findOnPath("docker")) return { command: "docker", docker: true };
  return undefined;
}

/**
 * Wrap weaver arguments in a `docker run` for the pinned image, mirroring
 * scripts/check-registry.mjs. `workdir` becomes the container CWD so weaver discovers a
 * `.weaver.toml` there; `interactive` (`-i`) keeps stdin open for a stdio server (MCP).
 * HOME is set because weaver caches under it.
 */
export function dockerArgs(opts: {
  mounts: DockerMount[];
  workdir?: string;
  interactive?: boolean;
  weaverArgs: string[];
}): string[] {
  const args = ["run", "--rm"];
  if (opts.interactive) args.push("-i");
  args.push("-e", "HOME=/tmp");
  for (const m of opts.mounts) {
    args.push("-v", `${m.host}:${m.container}${m.readOnly ? ":ro" : ""}`);
  }
  if (opts.workdir) args.push("-w", opts.workdir);
  args.push(IMAGE, ...opts.weaverArgs);
  return args;
}

/** The registry roots in the workspace — the folders weaver's `-r` should point at. */
export async function findRegistries(): Promise<string[]> {
  const manifests = await workspace.findFiles(MANIFEST_GLOB, "**/node_modules/**");
  return [...new Set(manifests.map((uri) => path.dirname(uri.fsPath)))];
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

export function findOnPath(cmd: string): string | undefined {
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
