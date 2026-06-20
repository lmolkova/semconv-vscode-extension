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
  - `server.ts` — LSP wiring (definition, references, hover, diagnostics, scan).

Both entry points are bundled by [esbuild.mjs](esbuild.mjs) into `out/`, with
`vscode` left external (provided by the host at runtime).

## Tests

- **Unit** (`pnpm test:unit`): `server/src/__tests__` — extraction + resolution.
- **Integration** (`pnpm test:integration`): `@vscode/test-electron` drives the
  real `executeDefinitionProvider` / `executeReferenceProvider` / diagnostics
  against the fixtures (downloads a throwaway VS Code build on first run).

  If you run it from inside an Electron-based terminal, first
  `unset ELECTRON_RUN_AS_NODE`, otherwise the downloaded VS Code launches as plain
  Node instead of as an editor.

## Publishing to the VS Code Marketplace

Releases are published with [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce)
under the `lmolkova` publisher (see `publisher` in [package.json](package.json)).

One-time setup:

1. Create a [publisher](https://marketplace.visualstudio.com/manage) on the
   Marketplace if one doesn't exist.
2. Generate a Personal Access Token with the **Marketplace → Manage** scope from
   [Azure DevOps](https://dev.azure.com), then `pnpm dlx @vscode/vsce login lmolkova`.

To cut a release:

```bash
# bump "version" in package.json first
pnpm dlx @vscode/vsce package   # builds a .vsix you can install locally to smoke-test
pnpm dlx @vscode/vsce publish    # builds + uploads to the Marketplace
```

`vscode:prepublish` runs `pnpm build`, so `out/` is always bundled fresh before
packaging. Only the files needed at runtime ship — keep `.vscodeignore` in sync
when adding sources or assets so `dev`/build files stay out of the `.vsix`.

## Out of scope (for now)

Completion in `ref:`, rename, document symbols, cross-registry
resolution, legacy version support.
