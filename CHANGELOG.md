# Changelog

User-facing changes to the extension. Newest first.

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
