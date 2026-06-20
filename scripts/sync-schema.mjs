import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { WEAVER_VERSION } from "./weaver-version.mjs";

// Vendors the OpenTelemetry Weaver JSON Schemas into the server bundle: the
// definition/2 registry schema and the registry-manifest schema. The pinned
// Weaver tag (scripts/weaver-version.mjs) is the single source of truth and is
// bumped by Renovate. CI re-runs this script and fails if a committed schema
// differs, so a version bump cannot merge without re-vendoring the JSON.

const SCHEMAS = ["semconv.schema.v2.json", "definition-manifest.v2.json"];

for (const name of SCHEMAS) {
  const url = `https://raw.githubusercontent.com/open-telemetry/weaver/${WEAVER_VERSION}/schemas/${name}`;
  const out = fileURLToPath(new URL(`../server/src/schema/${name}`, import.meta.url));

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  // Re-serialize with stable 2-space formatting and a trailing newline so the
  // committed file diffs cleanly regardless of upstream whitespace.
  const schema = await res.json();
  await writeFile(out, JSON.stringify(schema, null, 2) + "\n");
  console.log(`Vendored ${name} (weaver ${WEAVER_VERSION}) -> ${out}`);
}
