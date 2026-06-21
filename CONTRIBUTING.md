# Contributing

Thanks for your interest in improving the OpenTelemetry Semantic Conventions
(`definition/2`) language extension. This document covers the local development
setup, the codebase layout, and how to run the tests.

## Development

Requires **Node.js** (pnpm 11 won't run on older Node — `nvm install 22`). The exact
version is pinned in `.nvmrc` (`nvm use` to match it; CI reads the same file); the
supported floor is `package.json`'s `engines.node`.

This project uses [pnpm](https://pnpm.io) (pinned via the `packageManager` field;
run `corepack enable` once and the right version is used automatically).

```bash
pnpm install
pnpm build        # esbuild bundles client + server into out/
pnpm lint         # eslint (type-aware); pnpm lint:fix to autofix
pnpm format       # prettier --write; pnpm format:check to verify only
pnpm spell        # cspell spell-check (config + dictionary in cspell.json)
pnpm test         # typecheck + lint + format check + spell + unit tests
```

`pnpm test` is the full pre-push gate. Linting is [ESLint](https://eslint.org)
(flat config in [eslint.config.mjs](eslint.config.mjs), type-aware via
typescript-eslint, with import-sorting and JSDoc validation) and formatting is
[Prettier](https://prettier.io); the two are kept from conflicting by
`eslint-config-prettier`. Spelling is checked with [cspell](https://cspell.org) —
when it flags a legitimate term, add it to the `words` list in
[cspell.json](cspell.json). Install the recommended editor extensions
(`.vscode/extensions.json`) to get format, lint-fix, and spell-check inline.

Press **F5** ("Run Extension") to launch an Extension Development Host against
`test/fixtures/registry`. Point it at a real registry such as
[`semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai/) to try it on production files.

## Architecture

- `client/` — thin VS Code extension that launches the language server over IPC.
- `server/` — the language server:
  - `parser.ts` — YAML → AST with source offsets (via the `yaml` library).
  - `model.ts` — AST → `Definition[]` / `Reference[]` for one document.
  - `index.ts` — `RegistryIndex`: cross-file id → definitions / references.
  - `key-path.ts` — maps a cursor position to the structural schema path of the
    YAML key (or value) under it.
  - `schema-resolver.ts` — looks up a key's docs (description, allowed enum
    values) in the bundled JSON schema; powers hover on schema keys/enum values.
  - `server.ts` — LSP wiring (definition, references, hover, diagnostics, scan).

Both entry points are bundled by [esbuild.mjs](esbuild.mjs) into `out/`, with
`vscode` left external (provided by the host at runtime). The vendored schema
JSON is inlined into the server bundle, so no extra asset ships.

## Vendored schema

`server/src/schema/semconv.schema.v2.json` is the official Weaver `definition/2`
JSON schema, vendored at a pinned Weaver release. It is **generated** — don't edit
it by hand. The pinned tag lives in [scripts/weaver-version.mjs](scripts/weaver-version.mjs)
(`WEAVER_VERSION`) and is the single source of truth — shared by `pnpm sync-schema`
(which re-downloads the JSON for that tag) and `pnpm check-registry` (below).

Renovate watches the tag (a `customManager` in [renovate.json](renovate.json)) and
opens a PR when Weaver publishes a new release. That PR only bumps `WEAVER_VERSION`,
so CI re-runs `pnpm sync-schema` and fails the **drift check** (`git diff --exit-code`)
until the regenerated JSON is committed. On such a PR: run `pnpm sync-schema` locally,
review the schema diff, and commit it.

## Tests

- **Unit** (`pnpm test:unit`): `server/src/__tests__` — extraction + resolution.
- **Integration** (`pnpm test:integration`): `@vscode/test-electron` drives the
  real `executeDefinitionProvider` / `executeReferenceProvider` / diagnostics
  against the fixtures (downloads a throwaway VS Code build on first run).

  If you run it from inside an Electron-based terminal, first
  `unset ELECTRON_RUN_AS_NODE`, otherwise the downloaded VS Code launches as plain
  Node instead of as an editor.

- **Registry validation** (`pnpm check-registry`): runs `weaver registry check`
  on `test/fixtures/registry` via the pinned `otel/weaver` Docker image (so only
  Docker is needed, no host Weaver), keeping the fixtures valid `definition/2`
  semconv. The deliberately broken ref the diagnostics tests rely on lives in
  `test/fixtures/diagnostics/` — outside the validated registry — so it doesn't
  trip the check. CI runs this as the `registry` job.

## Releasing

Releases are built with [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce)
(a pinned devDependency) under the `LiudmilaMolkova` publisher (see `publisher` in
[package.json](package.json)).

Pushing a `vX.Y.Z` tag (matching `version` in [package.json](package.json)) runs the
`Release` workflow, which gates, packages the `.vsix`, publishes it to the VS Code
Marketplace (auth via the `VSCE_PAT` repository secret), then attaches the same
`.vsix` to a **GitHub Release**. Open VSX publishing is still planned; see
the _Publish to the extension marketplaces_ section in [TODO.md](TODO.md).

To cut a release:

```bash
# 1. bump "version" in package.json and add a CHANGELOG.md entry, commit
# 2. tag it (must match the new version) and push
git tag v0.1.1 && git push origin v0.1.1
```

Update [CHANGELOG.md](CHANGELOG.md) **only** with user-facing changes and
bugfixes (newest version on top) — it ships in the `.vsix` and is shown on the
Marketplace. Refactors, tests, tooling, and CI changes don't belong there.

The tag triggers [.github/workflows/release.yml](.github/workflows/release.yml),
which runs the full `pnpm test` gate, verifies the tag matches `package.json`'s
`version`, packages the `.vsix`, and attaches it to an auto-generated GitHub
Release. Users install it with `code --install-extension <file>.vsix` or the
Extensions panel's "Install from VSIX…".

To build the `.vsix` locally (e.g. to smoke-test before tagging):

```bash
pnpm package   # vsce package --no-dependencies → .vsix in the repo root
```

`vscode:prepublish` runs `pnpm build`, so `out/` is always bundled fresh before
packaging. Only the files needed at runtime ship — keep `.vscodeignore` in sync
when adding sources or assets so dev/build files stay out of the `.vsix`. The
native `keytar` / `@vscode/vsce-sign` build scripts are intentionally disabled in
`pnpm-workspace.yaml` (only `vsce publish`/login needs them, and CI passes the
token via env).

## Out of scope (for now)

Completion in `ref:`, rename, document symbols, cross-registry
resolution, legacy version support.
