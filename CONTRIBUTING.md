# Contributing

Bug reports and contributions to the OpenTelemetry Semantic Conventions
(`definition/2`) language extension are welcome.

## Setup

Requires **Node.js** (version pinned in `.nvmrc` — `nvm use` to match it) and
**pnpm** (run `corepack enable` once; the right version is then used
automatically).

```bash
pnpm install
```

## Make a change

The extension is split into `client/` (thin VS Code extension) and `server/`
(the language server, where most logic lives). After editing:

```bash
pnpm test    # the full pre-push gate: typecheck, lint, format, spell, unit tests
```

Useful while iterating: `pnpm lint:fix` and `pnpm format` to autofix, and
`pnpm test:unit` to run just the unit tests. When cspell flags a real term, add
it to the `words` list in [cspell.json](cspell.json).

## Try it out locally

Press **F5** ("Run Extension") to launch an Extension Development Host against
`test/fixtures/registry`. Point it at a real registry such as
[`semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai/)
to try it on production files.

To test the packaged extension, build a `.vsix` and install it (see README's
_Installation_):

```bash
pnpm package   # → .vsix in the repo root
```

## Vendored schema

`server/src/schema/semconv.schema.v2.json` is the official Weaver `definition/2`
schema — **generated, don't edit by hand**. The pinned Weaver tag lives in
[scripts/weaver-version.mjs](scripts/weaver-version.mjs); Renovate bumps it and
CI fails the drift check until the regenerated JSON is committed. To regenerate:

```bash
pnpm sync-schema   # re-downloads the JSON for the pinned tag
```

## Release

```bash
# 1. bump "version" in package.json and add a CHANGELOG.md entry, commit
# 2. tag (must match the version) and push
git tag v0.1.1 && git push origin v0.1.1
```

Pushing a `vX.Y.Z` tag runs the `Release` workflow, which gates, packages the
`.vsix`, publishes it to the VS Code Marketplace, and attaches it to a GitHub
Release. Update [CHANGELOG.md](CHANGELOG.md) with user-facing changes only
(newest on top) — it ships in the `.vsix` and shows on the Marketplace.
