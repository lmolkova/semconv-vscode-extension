import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import { Range } from "vscode-languageserver";
import { isMap, isScalar, isSeq, Node, YAMLMap } from "yaml";

import { nodeRange, ParsedSemconv } from "./parser";
import definitionSchema from "./schema/semconv.schema.v2.json";

export interface SchemaFinding {
  range: Range;
  message: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validateDefinition = ajv.compile(definitionSchema);

// Branch keywords whose own errors only restate that a sub-schema failed; the useful
// detail is on the leaf errors they wrap, so they are dropped to cut noise.
const META_KEYWORDS = new Set(["oneOf", "anyOf", "allOf", "if", "then", "else", "not"]);

/**
 * Validate a `definition/2` document against the bundled Weaver schema and map each
 * violation back to the offending YAML node's range. Manifests are intentionally not
 * validated here: the vendored manifest schema models `schema_url` as an object while
 * real manifests use the string form, so it would flag valid files (see `manifest.ts`).
 */
export function schemaDiagnostics(parsed: ParsedSemconv): SchemaFinding[] {
  if (parsed.kind !== "definition" || !parsed.root) return [];
  const data: unknown = parsed.doc.toJS();
  if (validateDefinition(data) || !validateDefinition.errors) return [];

  // A closed enum is modelled as `oneOf` of `const`s, so ajv emits one `const` error per
  // allowed value at the same path; collapse those into a single "one of" finding.
  const constValues = new Map<string, unknown[]>();
  const findings: SchemaFinding[] = [];
  const seen = new Set<string>();
  const push = (finding: SchemaFinding) => {
    const key = `${finding.range.start.line}:${finding.range.start.character}:${finding.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  for (const error of validateDefinition.errors) {
    if (META_KEYWORDS.has(error.keyword)) continue;
    if (error.keyword === "const") {
      const values = constValues.get(error.instancePath) ?? [];
      values.push(error.params.allowedValue);
      constValues.set(error.instancePath, values);
      continue;
    }
    push(findingFor(error, parsed));
  }

  for (const [instancePath, values] of constValues) {
    const target = nodeAtPointer(parsed.root, instancePath);
    push({
      range: nodeRange(target, parsed.offsets),
      message: `Value must be one of: ${values.join(", ")}.`,
    });
  }
  return findings;
}

function findingFor(error: ErrorObject, parsed: ParsedSemconv): SchemaFinding {
  const off = parsed.offsets;
  const target = nodeAtPointer(parsed.root, error.instancePath);

  switch (error.keyword) {
    case "required": {
      const missing = String(error.params.missingProperty);
      return { range: nodeRange(target, off), message: `Missing required field '${missing}'.` };
    }
    case "additionalProperties": {
      const extra = String(error.params.additionalProperty);
      const keyNode = isMap(target) ? keyNodeNamed(target, extra) : undefined;
      return { range: nodeRange(keyNode ?? target, off), message: `Unknown field '${extra}'.` };
    }
    case "enum": {
      const allowed = (error.params.allowedValues as unknown[] | undefined) ?? [];
      return {
        range: nodeRange(target, off),
        message: `Value must be one of: ${allowed.join(", ")}.`,
      };
    }
    default:
      return { range: nodeRange(target, off), message: error.message ?? "Invalid value." };
  }
}

/** Descend the YAML AST following a JSON Pointer (`/spans/0/name`) to the node at it. */
function nodeAtPointer(root: YAMLMap | undefined, instancePath: string): Node | undefined {
  if (!instancePath) return root;
  let node: Node | undefined = root;
  for (const raw of instancePath.split("/").slice(1)) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (isMap(node)) {
      node = node.get(token, true);
    } else if (isSeq(node)) {
      node = node.get(Number(token), true);
    } else {
      return undefined;
    }
    if (node == null) return undefined;
  }
  return node;
}

function keyNodeNamed(map: YAMLMap, name: string): Node | undefined {
  for (const pair of map.items) {
    const key = pair.key;
    if (isScalar(key) && String(key.value) === name) return key;
  }
  return undefined;
}
