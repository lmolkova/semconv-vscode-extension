import { DocumentSymbol, SymbolKind, SymbolTag } from "vscode-languageserver";

import { positionInRange } from "./parser";
import { Definition, DefKind } from "./types";

const DEF_SYMBOL_KIND: Record<DefKind, SymbolKind> = {
  attribute: SymbolKind.Field,
  attribute_group: SymbolKind.Namespace,
  entity: SymbolKind.Class,
  event: SymbolKind.Event,
  metric: SymbolKind.Number,
  span: SymbolKind.Method,
  enum_member: SymbolKind.EnumMember,
  entity_refinement: SymbolKind.Interface,
  event_refinement: SymbolKind.Interface,
  metric_refinement: SymbolKind.Interface,
  span_refinement: SymbolKind.Interface,
};

export function defKindToSymbolKind(kind: DefKind): SymbolKind {
  return DEF_SYMBOL_KIND[kind];
}

export function buildDocumentSymbols(defs: Definition[]): DocumentSymbol[] {
  const top: DocumentSymbol[] = [];
  const attributes: DocumentSymbol[] = [];

  for (const def of defs) {
    if (def.kind === "enum_member") continue;
    const symbol = toSymbol(def);
    top.push(symbol);
    if (def.kind === "attribute") attributes.push(symbol);
  }

  for (const def of defs) {
    if (def.kind !== "enum_member") continue;
    const symbol = toSymbol(def);
    const parent = attributes.find((a) => positionInRange(a.range, def.nameRange.start));
    if (parent) (parent.children ??= []).push(symbol);
    else top.push(symbol);
  }

  return top;
}

function toSymbol(def: Definition): DocumentSymbol {
  const symbol: DocumentSymbol = {
    name: def.id,
    kind: defKindToSymbolKind(def.kind),
    range: def.fullRange,
    selectionRange: def.nameRange,
  };
  const detail = def.type ?? def.instrument;
  if (detail) symbol.detail = detail;
  if (def.stability === "deprecated") symbol.tags = [SymbolTag.Deprecated];
  return symbol;
}
