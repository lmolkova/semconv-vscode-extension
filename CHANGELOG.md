# Changelog

User-facing changes to the extension. Newest first.

## Unreleased

- Rename (F2) an attribute, signal, or refinement and update every reference
  across the registry. The old id is kept as a deprecated `renamed_to` stub;
  internal attribute groups are renamed in place without one.

## 0.2.0

- Outline view per file and workspace-wide symbol search (Ctrl+T) over every
  attribute, group, signal, refinement, and enum-member id; enum members are nested
  under their attribute in the outline.
- Semantic syntax highlighting for `definition/2` and manifest files

## 0.1.0

- Go to Definition, Find All References, and Hover across a `definition/2`
  semantic-convention registry (`ref` / `ref_group` / `entity_associations` /
  signal refinements).
- Hover for fields and enum values in registry manifest files (identified by
  `schema_url`).
- Diagnostics for unresolved references and duplicate definitions, plus malformed
  or duplicate manifest dependency entries.
- Schema validation for `definition/2` documents: missing required fields, unknown
  fields, and invalid enum values are reported as errors on the offending YAML node.
- Manifest documents now warn on unknown fields (top-level and per dependency), an
  invalid `stability` value, and a `schema_url` that doesn't follow the OTel schema URL
  format (`https://host[:port]/<path>/<version>`), alongside the existing dependency
  checks.
