# Contributing

Thanks for your interest in improving the OpenTelemetry Semantic Conventions
(`definition/2`) language extension. This document covers the local development
setup, the codebase layout, and how to run the tests.

## Development

Requires **Node.js ≥ 22.13** (pnpm 11 won't run on older Node — `nvm install 22`).

This project uses [pnpm](https://pnpm.io) (pinned via the `packageManager` field;
run `corepack enable` once and the right version is used automatically).

```bash
pnpm install
pnpm build        # esbuild bundles client + server into out/
pnpm test         # typecheck + unit tests (vitest)
```

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

## Out of scope (for now)

Completion in `ref:`, rename, document symbols, cross-registry `imports`
resolution, and the legacy `definition/1` (`groups:`) format.
