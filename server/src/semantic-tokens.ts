import { Range, SemanticTokens, SemanticTokensBuilder } from "vscode-languageserver";

import { eachKeyValueScalar } from "./key-path";
import { ParsedSemconv, tokenRange } from "./parser";
import { definitionResolver, manifestResolver } from "./schema-resolver";
import { Definition, DefKind, Reference, RefKind } from "./types";

// Custom token types mapped to standard TextMate scopes in package.json
// (`contributes.semanticTokenScopes`), so every theme colors them from its own palette
// (works on light and dark) instead of hardcoded hex that only suits one theme.
const TOKEN_TYPES = [
  "semconvDefinition",
  "semconvReference",
  "semconvEnumMember",
  "semconvEnumValue",
  "semconvText",
  "semconvSchemaUrl",
] as const;
const TOKEN_MODIFIERS = ["unresolved"] as const;

type TokenType = (typeof TOKEN_TYPES)[number];

export const semanticTokensLegend = {
  tokenTypes: [...TOKEN_TYPES],
  tokenModifiers: [...TOKEN_MODIFIERS],
};

const TYPE_INDEX: Record<TokenType, number> = Object.fromEntries(
  TOKEN_TYPES.map((t, i) => [t, i]),
) as Record<TokenType, number>;

const UNRESOLVED = 1 << TOKEN_MODIFIERS.indexOf("unresolved");

const DEFINITION: TokenType = "semconvDefinition";
const REFERENCE: TokenType = "semconvReference";

const DEF_TOKEN: Record<DefKind, TokenType> = {
  attribute: DEFINITION,
  attribute_group: DEFINITION,
  entity: DEFINITION,
  event: DEFINITION,
  metric: DEFINITION,
  span: DEFINITION,
  enum_member: "semconvEnumMember",
  entity_refinement: DEFINITION,
  event_refinement: DEFINITION,
  metric_refinement: DEFINITION,
  span_refinement: DEFINITION,
};

// The md_* kinds never reach here (markdown gets no semantic tokens); listed only
// to keep this map exhaustive over RefKind.
const REF_TOKEN: Record<RefKind, TokenType> = {
  attribute_ref: REFERENCE,
  group_ref: REFERENCE,
  entity_assoc: REFERENCE,
  entity_refinement_ref: REFERENCE,
  event_refinement_ref: REFERENCE,
  metric_refinement_ref: REFERENCE,
  span_refinement_ref: REFERENCE,
  md_attribute_ref: REFERENCE,
  md_event_ref: REFERENCE,
  md_metric_ref: REFERENCE,
  md_span_ref: REFERENCE,
  md_entity_ref: REFERENCE,
  md_event_refinement_ref: REFERENCE,
  md_metric_refinement_ref: REFERENCE,
  md_span_refinement_ref: REFERENCE,
  md_entity_refinement_ref: REFERENCE,
};

export function buildSemanticTokens(
  parsed: ParsedSemconv,
  defs: Definition[],
  refs: Reference[],
  unresolved: Set<Reference>,
): SemanticTokens {
  const tokens: { line: number; char: number; length: number; type: number; mods: number }[] = [];

  // Semantic tokens can't span lines, so a multi-line scalar (e.g. a folded `note: >`
  // block) is emitted as one token per line.
  const add = (range: Range, type: TokenType, mods: number) => {
    for (let line = range.start.line; line <= range.end.line; line++) {
      const char = line === range.start.line ? range.start.character : 0;
      const endChar =
        line === range.end.line ? range.end.character : parsed.offsets.lineEndChar(line);
      const length = endChar - char;
      if (length <= 0) continue;
      tokens.push({ line, char, length, type: TYPE_INDEX[type], mods });
    }
  };

  for (const def of defs) add(def.nameRange, DEF_TOKEN[def.kind], 0);
  for (const ref of refs) {
    add(ref.range, REF_TOKEN[ref.refKind], unresolved.has(ref) ? UNRESOLVED : 0);
  }

  // Positions already claimed by a def/ref id; the plain-text pass must not double-token them.
  const claimed = new Set(tokens.map((t) => `${t.line}:${t.char}`));

  if (parsed.root && parsed.kind) {
    const resolver = parsed.kind === "manifest" ? manifestResolver : definitionResolver;
    eachKeyValueScalar(parsed.root, (steps, key, value) => {
      if (typeof value.value !== "string") return;
      const range = tokenRange(value, parsed.offsets);
      if (claimed.has(`${range.start.line}:${range.start.character}`)) return;
      const info = resolver.describeKeyPath(steps);
      let type: TokenType = "semconvText";
      if (info?.enumValues?.includes(value.value)) type = "semconvEnumValue";
      else if (parsed.kind === "manifest" && key === "schema_url") type = "semconvSchemaUrl";
      add(range, type, 0);
    });
  }

  // SemanticTokensBuilder delta-encodes, so tokens must be pushed in document order;
  // defs/refs/enum-values are collected separately above.
  tokens.sort((a, b) => a.line - b.line || a.char - b.char);
  const builder = new SemanticTokensBuilder();
  for (const t of tokens) builder.push(t.line, t.char, t.length, t.type, t.mods);
  return builder.build();
}
