import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Bumps package.json's "version" and rolls the CHANGELOG's "## Unreleased"
// entries into a new "## X.Y.Z" section. Driven by the Prepare release workflow
// (.github/workflows/prepare-release.yml), which opens a PR with the result;
// the Release workflow then tags the merged commit.

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node scripts/prepare-release.mjs <version>");
  process.exit(1);
}

const version = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version "${raw}": expected X.Y.Z`);
  process.exit(1);
}

const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const changelogPath = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));

const pkgText = await readFile(pkgPath, "utf8");
const current = JSON.parse(pkgText).version;
const updatedPkg = pkgText.replace(/(\n\s*"version":\s*")[^"]*(")/, `$1${version}$2`);
if (updatedPkg === pkgText) {
  console.error("Could not find a version field in package.json");
  process.exit(1);
}
if (current === version) {
  console.error(`package.json is already at ${version}`);
  process.exit(1);
}

const changelog = await readFile(changelogPath, "utf8");
const match = changelog.match(/\n## Unreleased\n([\s\S]*?)(?=\n## )/);
if (!match) {
  console.error("Could not find an '## Unreleased' section in CHANGELOG.md");
  process.exit(1);
}
const entries = match[1].trim();
if (!entries) {
  console.error("'## Unreleased' is empty — nothing to release");
  process.exit(1);
}

const updatedChangelog = changelog.replace(
  match[0],
  `\n## Unreleased\n\n## ${version}\n\n${entries}\n`,
);

await writeFile(pkgPath, updatedPkg);
await writeFile(changelogPath, updatedChangelog);
console.log(`Prepared release ${version} (was ${current})`);
