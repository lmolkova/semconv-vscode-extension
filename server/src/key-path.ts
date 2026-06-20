import { Position } from "vscode-languageserver";
import { isMap, isScalar, isSeq } from "yaml";

import { parseSemconv } from "./parser";

/** A step from the document root toward a hovered key, matching the JSON Schema shape. */
export type PathStep = { kind: "key"; name: string } | { kind: "item" };

export interface PathHit {
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

function offsetAt(text: string, position: Position): number {
  let line = 0;
  let i = 0;
  while (line < position.line && i < text.length) {
    if (text.charCodeAt(i) === 10 /* \n */) line++;
    i++;
  }
  return i + position.character;
}

function search(node: unknown, offset: number, steps: PathStep[]): PathHit | undefined {
  if (isMap(node)) {
    for (const pair of node.items) {
      const keyNode = pair.key;
      if (!isScalar(keyNode)) continue;
      const name = String(keyNode.value);
      if (inToken(keyNode, offset)) {
        return { steps: [...steps, { kind: "key", name }], key: name, onValue: false };
      }
      const value = pair.value;
      if (value && inToken(value, offset)) {
        const childSteps: PathStep[] = [...steps, { kind: "key", name }];
        if (isScalar(value)) {
          return {
            steps: childSteps,
            key: name,
            onValue: true,
            value: String(value.value),
          };
        }
        return search(value, offset, childSteps);
      }
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      if (inToken(item, offset)) {
        return search(item, offset, [...steps, { kind: "item" }]);
      }
    }
  }
  return undefined;
}

/**
 * If `position` sits on a YAML mapping key (or the scalar value of one), return the
 * structural schema path to that key. Returns undefined for non-key/value positions
 * or non-semconv documents. Firing only on the key token keeps this from colliding
 * with the id/ref hover, which owns id/ref value tokens.
 */
export function pathAt(text: string, position: Position): PathHit | undefined {
  const { isSemconv, root } = parseSemconv(text);
  if (!isSemconv || !root) return undefined;
  return search(root, offsetAt(text, position), []);
}
