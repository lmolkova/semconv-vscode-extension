import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { WEAVER_VERSION } from "./weaver-version.mjs";

// Validates the test-fixture registry with `weaver registry check`, run from the
// pinned otel/weaver container image so contributors and CI do not need a
// host-installed Weaver -- only Docker. The Weaver tag is pinned in
// scripts/weaver-version.mjs (the same one the vendored JSON schema tracks).
//
// The registry is bind-mounted at /registry and that is what `-r` points at, so
// the manifest.yaml at its root and every relative path resolve the same way
// they would for a host-installed weaver.

const registry = fileURLToPath(new URL("../test/fixtures/registry", import.meta.url));
const image = `otel/weaver:${WEAVER_VERSION}`;

const args = [
  "run",
  "--rm",
  "-v",
  `${registry}:/registry:ro`,
  "-e",
  "HOME=/tmp",
  image,
  "registry",
  "check",
  "-r",
  "/registry",
  "--v2",
  "true",
];

try {
  execFileSync("docker", args, { stdio: "inherit" });
} catch (err) {
  if (err.code === "ENOENT") {
    console.error(
      "Docker is required to run `weaver registry check`. Is it installed and running?",
    );
    process.exit(1);
  }
  process.exit(typeof err.status === "number" ? err.status : 1);
}
