import { Position } from "vscode-languageserver";
import { isMap, isScalar, isSeq, Scalar } from "yaml";

import { DocKind, ParsedSemconv, parseSemconv } from "./parser";

/** A step from the document root toward a hovered key, matching the JSON Schema shape. */
export type PathStep = { kind: "key"; name: string } | { kind: "item" };

export interface PathHit {
  /** Which schema the path should be resolved against. */
  kind: DocKind;
  /** Structural path root→target, e.g. [{key:'attributes'},{item},{key:'stability'}]. */
  steps: PathStep[];
  /** The key the path ends at. */
  key: string;
  /** True when the cursor was on the key's value scalar rather than the key itself. */
  onValue: boolean;
  /** The value text, when `onValue`. */
  value?: string;
}

type SourceRange = [number, number, number];

function rangeOf(node: unknown): SourceRange | undefined {
  const r = (node as { range?: SourceRange | null } | null)?.range;
  return r ?? undefined;
}

/** Is `offset` inside `node`'s token? Scalars use their value end; containers their node end. */
function inToken(node: unknown, offset: number): boolean {
  const r = rangeOf(node);
  if (!r) return false;
  const end = isScalar(node) ? r[1] : r[2];
  return offset >= r[0] && offset < end;
}

function search(
  node: unknown,
  offset: number,
  kind: DocKind,
  steps: PathStep[],
): PathHit | undefined {
  if (isMap(node)) {
    for (const pair of node.items) {
      const keyNode = pair.key;
      if (!isScalar(keyNode)) continue;
      const name = String(keyNode.value);
      if (inToken(keyNode, offset)) {
        return { kind, steps: [...steps, { kind: "key", name }], key: name, onValue: false };
      }
      const value = pair.value;
      if (value && inToken(value, offset)) {
        const childSteps: PathStep[] = [...steps, { kind: "key", name }];
        if (isScalar(value)) {
          return {
            kind,
            steps: childSteps,
            key: name,
            onValue: true,
            value: String(value.value),
          };
        }
        return search(value, offset, kind, childSteps);
      }
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      if (inToken(item, offset)) {
        return search(item, offset, kind, [...steps, { kind: "item" }]);
      }
    }
  }
  return undefined;
}

/**
 * If `position` sits on a YAML mapping key (or the scalar value of one), return the
 * structural schema path to that key. Returns undefined for non-key/value positions
 * or non-semconv documents. Callers should typically resolve id/ref hovers first
 * (via `RegistryIndex.symbolAt`) and fall back to schema-key hover when no symbol matches.
 * Takes a pre-parsed document so callers can cache the AST across hovers rather than
 * re-parsing on every cursor move.
 */
export function pathAtParsed(parsed: ParsedSemconv, position: Position): PathHit | undefined {
  const { kind, root, offsets } = parsed;
  if (!kind || !root) return undefined;
  return search(root, offsets.offset(position), kind, []);
}

export function pathAt(text: string, position: Position): PathHit | undefined {
  return pathAtParsed(parseSemconv(text), position);
}

/** A visitor callback receiving the schema path to a mapping key and its scalar value. */
type ScalarVisitor = (steps: PathStep[], key: string, value: Scalar) => void;

/**
 * Visit every mapping key whose value is a scalar, passing the schema path to that key.
 * Shares the root→leaf descent of `search` but walks the whole tree; `pathAtParsed`
 * remains the entry point when only one cursor position matters.
 */
export function eachKeyValueScalar(root: unknown, visit: ScalarVisitor): void {
  walkValues(root, [], visit);
}

function walkValues(node: unknown, steps: PathStep[], visit: ScalarVisitor): void {
  if (isMap(node)) {
    for (const pair of node.items) {
      const keyNode = pair.key;
      if (!isScalar(keyNode)) continue;
      const name = String(keyNode.value);
      const childSteps: PathStep[] = [...steps, { kind: "key", name }];
      const value = pair.value;
      if (isScalar(value)) visit(childSteps, name, value);
      else if (value) walkValues(value, childSteps, visit);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) walkValues(item, [...steps, { kind: "item" }], visit);
  }
}
