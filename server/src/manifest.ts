import { Range } from "vscode-languageserver";
import { isMap } from "yaml";

import { nodeRange, ParsedSemconv, scalarNode, seq, tokenRange } from "./parser";

export interface ManifestFinding {
  range: Range;
  message: string;
}

/**
 * Basic structural checks for a registry manifest's `dependencies`. The manifest's
 * own `schema_url` key is how a manifest is detected by `classify`,
 * so the only meaningful checks are on each dependency: every entry must carry its
 * required `schema_url`, and a `schema_url` must not be listed twice (it is the
 * unique identifier of the dependency registry). Returns [] for non-manifests.
 */
export function manifestDiagnostics(parsed: ParsedSemconv): ManifestFinding[] {
  if (parsed.kind !== "manifest" || !parsed.root) return [];
  const off = parsed.offsets;
  if (!parsed.root.has("dependencies")) return [];
  const deps = seq(parsed.root, "dependencies");
  if (!deps) {
    return [
      {
        range: nodeRange(parsed.root.get("dependencies", true), off),
        message: "Manifest 'dependencies' must be a list of dependency entries.",
      },
    ];
  }

  const findings: ManifestFinding[] = [];
  const seen = new Set<string>();
  for (const item of deps.items) {
    if (!isMap(item)) {
      findings.push({
        range: nodeRange(item, off),
        message: "Manifest dependency must be a mapping with a 'schema_url'.",
      });
      continue;
    }
    const urlNode = scalarNode(item, "schema_url");
    if (!urlNode || typeof urlNode.value !== "string") {
      // A non-string (object-form) schema_url is left to Weaver; only flag a missing one.
      if (!item.has("schema_url")) {
        findings.push({
          range: nodeRange(item, off),
          message: "Manifest dependency is missing the required 'schema_url'.",
        });
      }
      continue;
    }
    if (seen.has(urlNode.value)) {
      findings.push({
        range: tokenRange(urlNode, off),
        message: `Duplicate dependency: '${urlNode.value}' is listed more than once.`,
      });
    } else {
      seen.add(urlNode.value);
    }
  }
  return findings;
}
