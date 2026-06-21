import { Position, Range } from "vscode-languageserver";
import { Document, isMap, isScalar, isSeq, parseDocument, Scalar, YAMLMap, YAMLSeq } from "yaml";

const FILE_FORMAT_V2 = "definition/2";

export class OffsetConverter {
  private readonly lineStarts: number[];
  private readonly length: number;

  constructor(text: string) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) {
        starts.push(i + 1);
      }
    }
    this.lineStarts = starts;
    this.length = text.length;
  }

  position(offset: number): Position {
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

  offset(position: Position): number {
    const line = Math.max(0, Math.min(position.line, this.lineStarts.length - 1));
    return this.lineStarts[line] + position.character;
  }

  /** Character offset of the end of `line`'s content (before its newline). */
  lineEndChar(line: number): number {
    const next = this.lineStarts[line + 1];
    const end = next === undefined ? this.length : next - 1;
    return end - this.lineStarts[line];
  }
}

/** The semconv file kinds the server understands. Both drive schema-based hover. */
export type DocKind = "definition" | "manifest";

export interface ParsedSemconv {
  kind: DocKind | undefined;
  doc: Document.Parsed;
  root: YAMLMap | undefined;
  offsets: OffsetConverter;
}

/** A definition file declares `file_format`; a manifest carries `schema_url` and no format. */
function classify(root: YAMLMap | undefined): DocKind | undefined {
  if (!root) return undefined;
  // `file_format` is exclusive to definition files; a manifest never declares one.
  // An unrecognized format is an unknown definition, not a manifest, even with a `schema_url`.
  if (root.has("file_format")) {
    return readScalar(root, "file_format") === FILE_FORMAT_V2 ? "definition" : undefined;
  }
  if (root.has("schema_url")) return "manifest";
  return undefined;
}

export function parseSemconv(text: string): ParsedSemconv {
  const doc = parseDocument(text, { keepSourceTokens: false });
  const root = isMap(doc.contents) ? doc.contents : undefined;
  return { kind: classify(root), doc, root, offsets: new OffsetConverter(text) };
}

export function looksLikeSemconv(text: string): boolean {
  // Declaration is conventionally near the top; a full parse per file is too costly.
  const head = text.slice(0, 4096);
  return /^\s*file_format\s*:\s*["']?definition\/2["']?\s*$/m.test(head);
}

export function readScalar(map: YAMLMap, key: string): string | undefined {
  const node = map.get(key, true);
  if (isScalar(node) && typeof node.value === "string") {
    return node.value;
  }
  if (typeof node === "string") {
    return node;
  }
  return undefined;
}

export function scalarNode(map: YAMLMap, key: string): Scalar | undefined {
  const node = map.get(key, true);
  return isScalar(node) ? node : undefined;
}

export function seq(map: YAMLMap, key: string): YAMLSeq | undefined {
  const node = map.get(key, true);
  return isSeq(node) ? node : undefined;
}

export function mapItems(s: YAMLSeq | undefined): YAMLMap[] {
  return s ? s.items.filter(isMap) : [];
}

const Range0: Range = Range.create(0, 0, 0, 0);

/** Range of a scalar's value token, or a zero range when source positions are missing. */
export function tokenRange(node: Scalar, off: OffsetConverter): Range {
  const r = node.range;
  return r ? off.range(r[0], r[1]) : Range0;
}

/** Full range of any node (key/value/item), spanning to its node end. */
export function nodeRange(node: unknown, off: OffsetConverter): Range {
  const r = (node as { range?: [number, number, number] | null } | null)?.range;
  return r ? off.range(r[0], r[2]) : Range0;
}

/** Whether a position falls within a range (inclusive on both ends). */
export function positionInRange(range: Range, pos: Position): boolean {
  const afterStart =
    pos.line > range.start.line ||
    (pos.line === range.start.line && pos.character >= range.start.character);
  const beforeEnd =
    pos.line < range.end.line ||
    (pos.line === range.end.line && pos.character <= range.end.character);
  return afterStart && beforeEnd;
}
