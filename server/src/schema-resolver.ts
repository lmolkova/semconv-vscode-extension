import type { PathStep } from "./key-path";
import manifestSchema from "./schema/definition-manifest.v2.json";
import definitionSchema from "./schema/semconv.schema.v2.json";

/**
 * Looks up field documentation from a vendored upstream Weaver JSON Schema (the
 * `definition/2` registry schema or the registry-manifest schema). Pure and
 * dependency-free — no ajv. Schemas are inlined into the bundle by esbuild, so
 * this works offline at runtime. `createSchemaResolver` binds the traversal to
 * one schema; see `definitionResolver` / `manifestResolver` below.
 */

type Node = Record<string, unknown>;

export interface KeyDoc {
  description?: string;
  /** Allowed values when the field resolves to a closed enum (oneOf/anyOf of consts). */
  enumValues?: string[];
  deprecated?: boolean;
}

export interface SchemaResolver {
  /**
   * Resolve a structural path (from `pathAt`) to its schema documentation.
   * Returns undefined when the path doesn't correspond to a documented key.
   */
  describeKeyPath(steps: PathStep[]): KeyDoc | undefined;
}

function asNode(value: unknown): Node | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Node) : undefined;
}

/** A scalar `const`/`enum` value rendered as a string, or undefined for objects. */
function scalarString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Build a resolver bound to one schema; `$ref`s resolve against that same schema. */
export function createSchemaResolver(schema: Node): SchemaResolver {
  /** Follow `$ref` (`#/$defs/Name`) pointers until a concrete node, guarding cycles. */
  function resolveRef(node: Node | undefined, seen: Set<string> = new Set()): Node | undefined {
    let cur = node;
    while (cur && typeof cur.$ref === "string") {
      if (seen.has(cur.$ref)) return undefined;
      seen.add(cur.$ref);
      const parts = cur.$ref.replace(/^#\//, "").split("/");
      let target: unknown = schema;
      for (const part of parts) {
        target = asNode(target)?.[part];
      }
      cur = asNode(target);
    }
    return cur;
  }

  /**
   * Union of `properties` across a node and every `allOf`/`oneOf`/`anyOf` branch
   * so a key declared in any composition branch is found. First description wins
   * (direct properties take precedence, then allOf → oneOf → anyOf).
   */
  function collectProperties(node: Node | undefined): Record<string, Node> {
    const resolved = resolveRef(node);
    if (!resolved) return {};
    const out: Record<string, Node> = {};
    const props = asNode(resolved.properties);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        const valueNode = asNode(value);
        if (valueNode && !(key in out)) out[key] = valueNode;
      }
    }
    for (const comp of ["allOf", "oneOf", "anyOf"] as const) {
      const branches = resolved[comp];
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) {
        for (const [key, value] of Object.entries(collectProperties(asNode(branch)))) {
          if (!(key in out)) out[key] = value;
        }
      }
    }
    return out;
  }

  function childForStep(node: Node | undefined, step: PathStep): Node | undefined {
    const resolved = resolveRef(node);
    if (!resolved) return undefined;
    if (step.kind === "item") return asNode(resolved.items);
    const props = collectProperties(resolved);
    if (step.name in props) return props[step.name];
    // Unknown key: only documented when the object allows arbitrary properties
    // (additionalProperties is an object schema). `false`/absent → no hover.
    return asNode(resolved.additionalProperties);
  }

  /**
   * Collect the closed set of scalar values a field may take: `const`s and `enum`
   * entries, recursing through `oneOf`/`anyOf` branches and `$ref`s. Recursion is
   * needed because fields are often a nullable union of nested const-unions, e.g.
   * `anyOf: [{$ref: RequirementLevel}, {type: null}]` where RequirementLevel itself
   * is an anyOf whose first branch `$ref`s another oneOf-of-consts. Object branches
   * (structured forms) contribute nothing. Returns values in first-seen order.
   */
  function extractEnum(node: Node | undefined): string[] | undefined {
    const values: string[] = [];
    collectEnum(node, values, new Set<string>(), new Set<string>());
    return values.length ? values : undefined;
  }

  function collectEnum(
    node: Node | undefined,
    out: string[],
    seenValues: Set<string>,
    seenRefs: Set<string>,
  ): void {
    const resolved = resolveRef(node, seenRefs);
    if (!resolved) return;

    const push = (value: string | undefined) => {
      if (value !== undefined && !seenValues.has(value)) {
        seenValues.add(value);
        out.push(value);
      }
    };

    push(scalarString(resolved.const));
    if (Array.isArray(resolved.enum)) {
      for (const value of resolved.enum) push(scalarString(value));
    }
    for (const comp of ["oneOf", "anyOf"] as const) {
      const branches = resolved[comp];
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) collectEnum(asNode(branch), out, seenValues, seenRefs);
    }
  }

  function buildKeyDoc(propNode: Node): KeyDoc {
    const resolved = resolveRef(propNode);
    // Property-level description wins (e.g. `stability` overrides the Stability def's).
    const description =
      typeof propNode.description === "string"
        ? propNode.description
        : typeof resolved?.description === "string"
          ? resolved.description
          : undefined;
    const doc: KeyDoc = {};
    if (description) doc.description = description;
    const enumValues = extractEnum(resolved);
    if (enumValues) doc.enumValues = enumValues;
    if (propNode.deprecated === true || resolved?.deprecated === true) doc.deprecated = true;
    return doc;
  }

  function describeKeyPath(steps: PathStep[]): KeyDoc | undefined {
    let node: Node | undefined = schema;
    let propNode: Node | undefined;
    for (const step of steps) {
      const child = childForStep(node, step);
      if (!child) return undefined;
      if (step.kind === "key") propNode = child;
      node = child;
    }
    return propNode ? buildKeyDoc(propNode) : undefined;
  }

  return { describeKeyPath };
}

export const definitionResolver = createSchemaResolver(definitionSchema);
export const manifestResolver = createSchemaResolver(manifestSchema);
