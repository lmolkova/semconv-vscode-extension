## Toolchain
- **Node.js ≥ 22.13** required (pnpm 11 won't run on older Node — `nvm install 22`).
- **pnpm** only. Run `corepack enable` once. Never use `npm`/`yarn` or create `package-lock.json`; the lockfile is `pnpm-lock.yaml`.

## Commands
```bash
pnpm install                   # install deps
pnpm install --frozen-lockfile # reproducible install (CI)
pnpm build                     # bundle client + server into out/ (esbuild)
pnpm test                      # typecheck + unit tests (vitest)
pnpm test:integration          # @vscode/test-electron e2e
```

## Supply chain — don't weaken
Hardening is in `pnpm-workspace.yaml`: `minimumReleaseAge: 10080` (1wk) and `allowBuilds` (dep build scripts blocked by default; allowlist only vetted packages). Updates go through Renovate (`renovate.json`) — don't bump versions by hand.

## Architecture
- `client/` — thin VS Code extension; launches the server over IPC.
- `server/` — language server: `parser.ts` (YAML→AST) → `model.ts` (defs/refs per doc) → `index.ts` (cross-file `RegistryIndex`) → `server.ts` (LSP wiring).
- `esbuild.mjs` bundles both into `out/`, `vscode` left external.

## Style
- Be concise. Match the surrounding code's naming and idioms.
- Don't write comments that restate what the code does. Comment only when the code isn't self-explanatory — explain *why*, not *what*.

## Docs
- `README.md` is user-facing (VS Code Marketplace description). Keep internal details and dev/build process **out** of it — those belong in `CONTRIBUTING.md`.
- `CONTRIBUTING.md` is the human-oriented version of this file.
