## Toolchain

- **Node.js** required (pnpm 11 won't run on older Node — `nvm install 22`). Exact version is pinned in `.nvmrc` (CI reads it too); the supported floor is `package.json`'s `engines.node`.
- **pnpm** only. Run `corepack enable` once. Never use `npm`/`yarn` or create `package-lock.json`; the lockfile is `pnpm-lock.yaml`.

## Commands

```bash
pnpm install                   # install deps
pnpm install --frozen-lockfile # reproducible install (CI)
pnpm build                     # bundle client + server into out/ (esbuild)
pnpm lint                      # eslint (type-aware) — `pnpm lint:fix` to autofix
pnpm format                    # prettier --write (`pnpm format:check` to verify)
pnpm spell                     # cspell — add project terms to cspell.json's `words`
pnpm test                      # typecheck + lint + format check + spell + unit tests
pnpm test:integration          # @vscode/test-electron e2e
```

`pnpm test` is the full gate (what CI should run). ESLint uses `eslint.config.mjs`
(flat config, type-aware via typescript-eslint's project service); Prettier owns
formatting and is wired into ESLint via `eslint-config-prettier` so the two don't
fight. Don't add stylistic ESLint rules — formatting is Prettier's job. ESLint also
runs `simple-import-sort` (autofixable) and `jsdoc` (validates JSDoc you write but
never requires it). Spell-checking is cspell — when it flags a real term, add it to
the `words` list in `cspell.json` rather than rewording.

## Supply chain — don't weaken

Hardening is in `pnpm-workspace.yaml`: `minimumReleaseAge: 10080` (1wk) and `allowBuilds` (dep build scripts blocked by default; allowlist only vetted packages). Updates go through Renovate (`renovate.json`) — don't bump versions by hand.

## Architecture

- `client/` — thin VS Code extension; launches the server over IPC.
- `server/` — language server: `parser.ts` (YAML→AST) → `model.ts` (defs/refs per doc) → `index.ts` (cross-file `RegistryIndex`) → `server.ts` (LSP wiring).
- `esbuild.mjs` bundles both into `out/`, `vscode` left external.

## Style

- Be concise. Match the surrounding code's naming and idioms.
- **Default to zero comments.** Fix unclear code with better names, not comments.
- Only comment a genuine gotcha (non-obvious workaround, ordering constraint, upstream bug) or link an issue/spec. The bar: a competent reader is _stuck_ without it. "Helpful context", "explains why", "documents the choice" don't qualify.
- When editing, delete comments that fail this bar.

## Docs

- `README.md` is user-facing (VS Code Marketplace description). Keep internal details and dev/build process **out** of it — those belong in `CONTRIBUTING.md`.
- `CONTRIBUTING.md` is the human-oriented version of this file.
