# OpenTelemetry Semantic Conventions (`definition/2`)

IDE language support for OpenTelemetry [Weaver](https://github.com/open-telemetry/weaver)
semantic-convention YAML files that declare `file_format: definition/2`
([schema](https://github.com/open-telemetry/weaver/blob/main/schemas/semconv.schema.v2.json)).

Navigate and validate a semantic-convention registry the same way you would a
codebase — jump to where an attribute is defined, find everywhere it's used, and
catch broken references as you type.

> **Unofficial.** This is an unofficial project and is not
> endorsed by the OpenTelemetry project.

Built for registries authored with [Weaver](https://github.com/open-telemetry/weaver),
such as [`semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai).

## Features

- **Go to Definition** — jump from a `ref` / `ref_group` / `entity_associations` /
  refinement `ref` to the entity that defines that id, across files.
- **Find All References** — from any attribute/group/signal id to every place it
  is referenced in the registry.
- **Hover** — see the id, kind, type/stability/unit, and brief of the referenced
  entity. Hovering a schema field (`key`, `stability`, `instrument`, …) or an enum
  value shows its description and allowed values, straight from the official schema.
  Field hover also works in registry **manifest** files (`schema_url`,
  `dependencies`, `stability`, …).
- **Diagnostics** — unresolved references and duplicate definitions, plus
  malformed or duplicate manifest dependency entries, flagged inline.

### What links to what

| Definition      | id field      | Reference               | Resolves to         |
| --------------- | ------------- | ----------------------- | ------------------- |
| attribute       | `key`         | `ref`                   | attribute           |
| attribute_group | `id`          | `ref_group`             | attribute_group     |
| entity / span   | `type`        | `entity_associations[]` | entity              |
| event / metric  | `name`        | `*_refinements[].ref`   | the matching signal |
| enum member     | `id` (inline) |                         |                     |

Files are recognized by **content**, not by file name: definition files declare
`file_format: definition/2`, and a registry manifest is identified by its
`schema_url` (with no `file_format`). The extension indexes every definition file
in your workspace folder, so navigation works across the whole registry; manifest
files get field hover and dependency diagnostics.

## Requirements

- VS Code 1.96 or newer.
- A workspace folder containing `definition/2` semantic-convention YAML files.

## Installation

- **Marketplace:** search for _OpenTelemetry Semantic Conventions_ in the
  Extensions view and install.
- **From a `.vsix`:** download the package, then run
  _Extensions: Install from VSIX…_ from the Command Palette.

No configuration is required — open a folder with semantic-convention files and
the features above work automatically on YAML files.

## Settings

| Setting                | Default | Description                                                                                                                     |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `semconv.trace.server` | `off`   | Log the communication between VS Code and the language server (`off` / `messages` / `verbose`). Useful when reporting an issue. |

## Limitations

Not yet supported: completion in `ref:`, rename, document symbols, cross-registry
resolution, and the legacy `definition/1` (`groups:`) format.

## Contributing

Bug reports and contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for the development setup, architecture, and tests.

## License

[Apache-2.0](LICENSE).
