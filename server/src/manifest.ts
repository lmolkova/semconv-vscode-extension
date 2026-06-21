import { Range } from "vscode-languageserver";
import { isMap, isScalar, Scalar, YAMLMap } from "yaml";

import { nodeRange, OffsetConverter, ParsedSemconv, scalarNode, seq, tokenRange } from "./parser";
import manifestSchema from "./schema/definition-manifest.v2.json";

export interface ManifestFinding {
  range: Range;
  message: string;
}

// Allowed keys and the `stability` enum are read from the bundled manifest schema so
// they stay correct when the schema is re-vendored. The schema itself can't be fed to a
// JSON-schema validator: it models `schema_url` as an object while real manifests use the
// string form, and it sets no `additionalProperties: false`, so unknown fields go
// uncaught. These checks fill that gap by hand. They are warnings, not errors, because
// the schema does not strictly forbid extra fields.
const TOP_LEVEL_KEYS = new Set<string>(Object.keys(manifestSchema.properties));
const DEPENDENCY_KEYS = new Set<string>(Object.keys(manifestSchema.$defs.Dependency.properties));
const STABILITY_VALUES: string[] = manifestSchema.$defs.Stability.oneOf.map(
  (branch) => branch.const,
);

// OTel schema URL format: `http[s]://host[:port]/<path>/<major.minor.patch>`, where the
// version is the last path segment with an optional ASCII suffix (e.g. `-rc.1`). The path
// is otherwise unconstrained. See the SchemaUrl `$ref` description in
// definition-manifest.v2.json.
const SCHEMA_URL_RE = /^https?:\/\/[^/\s]+\/(.+\/)?\d+\.\d+\.\d+[^/\s]*$/;

/**
 * Structural checks for a registry manifest: unknown top-level/dependency fields, an
 * invalid `stability` value, and per-dependency `schema_url` presence/uniqueness (its
 * unique identifier). The manifest's own `schema_url` is how `classify` detects a
 * manifest, so it is always present. Returns [] for non-manifests.
 */
export function manifestDiagnostics(parsed: ParsedSemconv): ManifestFinding[] {
  if (parsed.kind !== "manifest" || !parsed.root) return [];
  const off = parsed.offsets;
  const findings: ManifestFinding[] = [];

  unknownKeys(parsed.root, TOP_LEVEL_KEYS, off, findings);

  const schemaUrl = scalarNode(parsed.root, "schema_url");
  if (schemaUrl) checkSchemaUrl(schemaUrl, off, findings);

  const stability = scalarNode(parsed.root, "stability");
  if (stability) {
    const text = scalarText(stability.value);
    if (text != null && !STABILITY_VALUES.includes(text)) {
      findings.push({
        range: tokenRange(stability, off),
        message: `Value must be one of: ${STABILITY_VALUES.join(", ")}.`,
      });
    }
  }

  if (!parsed.root.has("dependencies")) return findings;
  const deps = seq(parsed.root, "dependencies");
  if (!deps) {
    findings.push({
      range: nodeRange(parsed.root.get("dependencies", true), off),
      message: "Manifest 'dependencies' must be a list of dependency entries.",
    });
    return findings;
  }

  const seen = new Set<string>();
  for (const item of deps.items) {
    if (!isMap(item)) {
      findings.push({
        range: nodeRange(item, off),
        message: "Manifest dependency must be a mapping with a 'schema_url'.",
      });
      continue;
    }
    unknownKeys(item, DEPENDENCY_KEYS, off, findings);
    const urlNode = scalarNode(item, "schema_url");
    if (!urlNode) {
      // Object-form schema_url (a mapping) is left to Weaver; only a truly absent one is
      // flagged here. A scalar that isn't a valid URL is caught by checkSchemaUrl below.
      if (!item.has("schema_url")) {
        findings.push({
          range: nodeRange(item, off),
          message: "Manifest dependency is missing the required 'schema_url'.",
        });
      }
      continue;
    }
    checkSchemaUrl(urlNode, off, findings);
    const url = scalarText(urlNode.value);
    if (url == null) continue;
    if (seen.has(url)) {
      findings.push({
        range: tokenRange(urlNode, off),
        message: `Duplicate dependency: '${url}' is listed more than once.`,
      });
    } else {
      seen.add(url);
    }
  }
  return findings;
}

function checkSchemaUrl(node: Scalar, off: OffsetConverter, findings: ManifestFinding[]): void {
  const text = scalarText(node.value);
  if (text == null) return;
  if (!SCHEMA_URL_RE.test(text)) {
    findings.push({
      range: tokenRange(node, off),
      message:
        "Schema URL must follow 'http(s)://host[:port]/<path>/<version>' " +
        "with a 'major.minor.patch' version (e.g. .../1.0.0).",
    });
  }
}

/** A scalar's primitive value as text; undefined for null or non-primitive nodes. */
function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function unknownKeys(
  map: YAMLMap,
  allowed: Set<string>,
  off: OffsetConverter,
  findings: ManifestFinding[],
): void {
  for (const pair of map.items) {
    const key = pair.key;
    if (isScalar(key) && typeof key.value === "string" && !allowed.has(key.value)) {
      findings.push({ range: tokenRange(key, off), message: `Unknown field '${key.value}'.` });
    }
  }
}
