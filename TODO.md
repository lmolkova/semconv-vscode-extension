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

## Integrate with Weaver

- [ ] Surface `weaver registry check` results as diagnostics (run the Weaver CLI and
      map its output back to ranges) so editor warnings match CI.
- [ ] Consider a command to run Weaver codegen / live-resolve from within VS Code.

## Publish to the extension marketplaces

Tagging `vX.Y.Z` (matching `package.json` `version`) runs
[.github/workflows/release.yml](.github/workflows/release.yml), which builds the
`.vsix`, publishes it to the VS Code Marketplace under the `LiudmilaMolkova`
publisher (auth via the `VSCE_PAT` secret), and attaches the `.vsix` to a GitHub
Release. Users can also install manually via `code --install-extension <file>.vsix`.

## Other features

- [ ] **Rename** — rename an attribute key / group id and update every reference
      across the registry (`renameProvider`).
- [ ] **Document & Workspace Symbols** — outline view per file
      (`documentSymbolProvider`) and `workspace/symbol` search over all ids.
- [ ] **CodeLens / inlay hints** — e.g. reference counts above a definition,
      inherited-attribute hints on `extends` / `ref_group`.
