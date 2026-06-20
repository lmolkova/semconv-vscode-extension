import { Position, Range } from "vscode-languageserver";
import { Document, isMap, isScalar, parseDocument, Scalar, YAMLMap } from "yaml";

const FILE_FORMAT_V2 = "definition/2";

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
}

export interface ParsedSemconv {
  isSemconv: boolean;
  doc: Document.Parsed;
  root: YAMLMap | undefined;
  offsets: OffsetConverter;
}

export function parseSemconv(text: string): ParsedSemconv {
  const doc = parseDocument(text, { keepSourceTokens: false });
  const root = isMap(doc.contents) ? doc.contents : undefined;
  const isSemconv = root ? readScalar(root, "file_format") === FILE_FORMAT_V2 : false;
  return { isSemconv, doc, root, offsets: new OffsetConverter(text) };
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
