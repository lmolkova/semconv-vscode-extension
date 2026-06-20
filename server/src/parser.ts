import { Document, parseDocument, isMap, YAMLMap, Scalar, isScalar } from 'yaml';
import { Position, Range } from 'vscode-languageserver';

const FILE_FORMAT_V2 = 'definition/2';

/**
 * Converts byte offsets (as produced by the `yaml` AST `range` tuples) into
 * LSP line/character positions. Built once per document from a precomputed
 * table of line-start offsets so conversions are O(log n).
 */
export class OffsetConverter {
  private readonly lineStarts: number[];

  constructor(text: string) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) {
        starts.push(i + 1);
      }
    }
    this.lineStarts = starts;
  }

  position(offset: number): Position {
    // Binary search for the last line whose start is <= offset.
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return Position.create(lo, offset - this.lineStarts[lo]);
  }

  range(start: number, end: number): Range {
    return Range.create(this.position(start), this.position(end));
  }
}

export interface ParsedSemconv {
  /** True when the root declares `file_format: definition/2`. */
  isSemconv: boolean;
  doc: Document.Parsed;
  root: YAMLMap | undefined;
  offsets: OffsetConverter;
}

/** Parse YAML text and detect whether it is a semconv definition/2 document. */
export function parseSemconv(text: string): ParsedSemconv {
  const doc = parseDocument(text, { keepSourceTokens: false });
  const root = isMap(doc.contents) ? doc.contents : undefined;
  const isSemconv = root ? readScalar(root, 'file_format') === FILE_FORMAT_V2 : false;
  return { isSemconv, doc, root, offsets: new OffsetConverter(text) };
}

/** Quick content sniff used by the workspace scan — avoids a full parse per file. */
export function looksLikeSemconv(text: string): boolean {
  // The declaration is conventionally at the top; scan a small prefix.
  const head = text.slice(0, 4096);
  return /^\s*file_format\s*:\s*["']?definition\/2["']?\s*$/m.test(head);
}

/** Read a scalar string value for `key` from a map, or undefined. */
export function readScalar(map: YAMLMap, key: string): string | undefined {
  const node = map.get(key, true);
  if (isScalar(node) && typeof node.value === 'string') {
    return node.value;
  }
  if (typeof node === 'string') {
    return node;
  }
  return undefined;
}

/** Get the Scalar *node* (with source range) for `key`, or undefined. */
export function scalarNode(map: YAMLMap, key: string): Scalar | undefined {
  const node = map.get(key, true);
  return isScalar(node) ? (node as Scalar) : undefined;
}
