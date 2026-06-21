# Roadmap / TODO

Future work beyond the initial slice (go-to-definition, find-references, hover,
basic diagnostics). See [README.md](README.md) for what already works.

## Support dependencies (cross-registry imports)

Today the index only sees `definition/2` files in the open workspace folder, and
unresolved-reference diagnostics are **suppressed entirely** whenever any file
declares an `imports` section (because the imported id universe is unknown).

- [ ] Parse the root `imports` wildcards (`attribute_groups`, `entities`, `events`,
      `metrics`, `spans`) and the `model/manifest.yaml` dependency list.
- [ ] Resolve and index dependency registries (local build dirs, e.g.
      `.build/sc-upstream-filtered`, and/or fetched/pinned upstream registries).
- [ ] Make go-to-definition / find-references / hover work across registry
      boundaries (jump into an imported attribute's definition).
- [ ] Re-enable precise unresolved-reference diagnostics once the imported ids are
      known, instead of blanket suppression — match imported ids against the
      declared wildcards. (Replaces the current rule in [server/src/index.ts](server/src/index.ts) `unresolvedReferences`.)

## Support definition manifest files

Manifest files (no `file_format`, identified by `schema_url`) are recognized as a
first-class document kind, with schema-driven **hover** for their fields and enum
values (from the vendored `definition-manifest.v2.json`) and **basic diagnostics**
for malformed/duplicate dependency entries. The remaining work is consuming the
manifest for cross-registry resolution.

- [ ] Use the manifest to discover the registry root and the dependency list that
      feeds cross-registry import resolution (see _Support dependencies_ above).
- [ ] Go-to-definition / hover on a dependency entry — jump to or describe the
      resolved registry.

## Support autocomplete

- [ ] Completion inside `ref:` — suggest attribute keys from the index (local +
      imported).
- [ ] Completion inside `ref_group:` — suggest attribute group ids.
- [ ] Completion inside `entity_associations:` — suggest entity types.
- [ ] Completion for refinement `ref:` — suggest ids of the matching signal kind.
- [ ] Context-aware: only offer candidates of the kind valid at the cursor; show
      brief/stability in the completion detail.
- [ ] Advertise `completionProvider` (with `:` / space trigger chars) in the server
      capabilities in [server/src/server.ts](server/src/server.ts).

## Validate documents against the bundled JSON schema

- [x] Validate each open `definition/2` document against the bundled
      `server/src/schema/semconv.schema.v2.json` (with `ajv`) and publish the
      structural errors (missing required fields, unknown properties, bad enums)
      as diagnostics, mapped back to the offending YAML node's range — see
      [server/src/schema-validate.ts](server/src/schema-validate.ts), wired into
      `validate()` in [server/src/server.ts](server/src/server.ts) as errors.
- [ ] Validate **manifests** too. Blocked: the vendored
      `definition-manifest.v2.json` models `schema_url` (top-level and per
      dependency) as an object `{url}`, but real manifests use the string form, so
      validating against it flags valid files. Manifests keep the hand-rolled
      checks in [server/src/manifest.ts](server/src/manifest.ts) until the schema
      is fixed upstream or the data is normalized before validation.

## Integrate with Weaver

- [ ] Surface `weaver registry check` results as diagnostics (run the Weaver CLI and
      map its output back to ranges) so editor warnings match CI.
- [ ] Read `weaver.yaml` / registry manifest to discover the registry root, included
      paths, and dependency resolution rather than scanning blindly.
- [ ] Consider a command to run Weaver codegen / live-resolve from within VS Code.

## Publish to the extension marketplaces (release phase 2)

Phase 1 is done: tagging `vX.Y.Z` (matching `package.json` `version`) runs
[.github/workflows/release.yml](.github/workflows/release.yml), which builds the
`.vsix` and attaches it to a GitHub Release. Users install it via
`code --install-extension <file>.vsix` or the Extensions panel's "Install from VSIX…".

Phase 2 turns those releases into Marketplace publishes — same `vsce package`
output, plus publish steps and credentials:

- [ ] Register the `lmolkova` publisher on the VS Code Marketplace and create an
      Azure DevOps Personal Access Token (Marketplace → Manage publish access).
      Store it as the `VSCE_PAT` GitHub Actions secret.
- [ ] Add `vsce publish --no-dependencies -p $VSCE_PAT` to the release job (after
      packaging). `VSCE_PAT` via env means no `keytar` / interactive login —
      keep `keytar` and `@vscode/vsce-sign` builds disabled in `pnpm-workspace.yaml`.
- [ ] (Optional) Also publish to the Open VSX Registry for VSCodium / Cursor /
      Gitpod: add the `ovsx` dep + `ovsx publish -p $OVSX_PAT` and an `OVSX_PAT`
      secret from open-vsx.org.
- [ ] Decide a version-bump flow (manual bump + tag, or a release bot) so the tag
      guard in the workflow stays satisfied.
- [ ] (Optional) Pre-release channel via `vsce publish --pre-release` for insider builds.

## Other features

- [ ] **Rename** — rename an attribute key / group id and update every reference
      across the registry (`renameProvider`).
- [ ] **Document & Workspace Symbols** — outline view per file
      (`documentSymbolProvider`) and `workspace/symbol` search over all ids.
- [ ] **CodeLens / inlay hints** — e.g. reference counts above a definition,
      inherited-attribute hints on `extends` / `ref_group`.
