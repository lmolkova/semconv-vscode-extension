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

## Generated fixture docs

[`test/fixtures/docs`](test/fixtures/docs) holds example Weaver-generated
documentation for the test-fixture registry — the attribute registry pages
under `registry/` and the hand-written signal docs (`spans.md`, `metrics.md`,
`events.md`) whose tables Weaver fills in. The signal docs are authored by
hand except for the blocks between `<!-- weaver {jq query} -->` and
`<!-- endweaver -->` markers, which Weaver rewrites in place. The `jq` query
selects what to render — for example:

```text
<!-- weaver .registry.spans[] | select(.type == "gen_ai.inference.client") -->
<!-- weaver .registry.metrics[] | select(.name == "gen_ai.client.token.usage") -->
<!-- weaver .registry.events[] | select(.name == "gen_ai.evaluation.result") -->
<!-- weaver .refinements.spans[] | select(.id == "openai.inference.client") | .attributes |= map(select(.key != "gen_ai.provider.name")) -->
```

A `template:` prefix overrides the default `snippet.md.j2` with another template
from the markdown target dir (e.g. render just the attribute table):

```text
<!-- weaver template:attributes_only.md.j2 .registry.spans[] | select(.type == "gen_ai.inference.client") -->
```

The templates live in
[`test/fixtures/templates/registry/markdown`](test/fixtures/templates/registry/markdown)
(vendored from
[`semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai/)).
Regeneration runs Weaver from the pinned `otel/weaver` Docker image (same tag
as the vendored schema), so only Docker is needed:

```bash
make generate      # or: pnpm generate-docs
```

CI fails if the committed docs drift from `make generate`, so rerun it after
editing the registry, the templates, or a snippet query, and commit the result.

## Release

Two workflows, both `workflow_dispatch`:

1. **Prepare release** — run it with the new version (e.g. `0.1.1`):

   ```bash
   gh workflow run prepare-release.yml -f version=0.1.1
   ```

   It runs [scripts/prepare-release.mjs](scripts/prepare-release.mjs) to bump
   `version` in `package.json` and roll the [CHANGELOG.md](CHANGELOG.md)
   `## Unreleased` entries into a `## 0.1.1` section, then opens a PR. Review
   and merge it. (Add user-facing changes under `## Unreleased` as you go,
   newest on top — only those go into the release.)

2. **Release** — after the bump is merged, run it with the matching tag:

   ```bash
   gh workflow run release.yml -f tag=v0.1.1
   ```

   It verifies the tag matches `package.json`, creates and pushes the tag, then
   gates, packages the `.vsix`, publishes it to the VS Code Marketplace, and
   attaches it to a GitHub Release. The CHANGELOG ships in the `.vsix` and shows
   on the Marketplace.

Both accept the **Run workflow** button on the Actions tab instead of `gh`. The
tag is cut from `main`'s HEAD at dispatch time, so make sure the prepare PR is
merged first.
