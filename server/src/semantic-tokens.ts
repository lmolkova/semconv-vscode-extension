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

const REF_TOKEN: Record<RefKind, TokenType> = {
  attribute_ref: REFERENCE,
  group_ref: REFERENCE,
  entity_assoc: REFERENCE,
  entity_refinement_ref: REFERENCE,
  event_refinement_ref: REFERENCE,
  metric_refinement_ref: REFERENCE,
  span_refinement_ref: REFERENCE,
  prose_ref: REFERENCE,
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
  proseRefs: Reference[],
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
  // Resolved prose mentions render as references; the surrounding prose stays plain
  // text via the split below.
  for (const ref of proseRefs) add(ref.range, REFERENCE, 0);

  // The brief/note ranges carrying a prose mention, so the plain-text pass can emit
  // the prose around the (already-tokenized) mention without overlapping it.
  const proseSpans = proseRefs.map((r) => ({
    start: parsed.offsets.offset(r.range.start),
    end: parsed.offsets.offset(r.range.end),
  }));

  // Positions already claimed by a def/ref id; the plain-text pass must not double-token them.
  const claimed = new Set(tokens.map((t) => `${t.line}:${t.char}`));

  if (parsed.root && parsed.kind) {
    const resolver = parsed.kind === "manifest" ? manifestResolver : definitionResolver;
    eachKeyValueScalar(parsed.root, (steps, key, value) => {
      if (typeof value.value !== "string") return;
      const range = tokenRange(value, parsed.offsets);
      if (claimed.has(`${range.start.line}:${range.start.character}`)) return;

      // A brief/note value carrying prose mentions: emit the prose between/around the
      // mention tokens as plain text, leaving the mentions as the references above.
      if (value.range) {
        const [from, to] = value.range;
        const spans = proseSpans
          .filter((s) => s.start >= from && s.end <= to)
          .sort((a, b) => a.start - b.start);
        if (spans.length) {
          let cursor = from;
          for (const s of spans) {
            if (s.start < cursor) continue; // overlapping (nested) mention
            if (s.start > cursor) add(parsed.offsets.range(cursor, s.start), "semconvText", 0);
            cursor = s.end;
          }
          if (cursor < to) add(parsed.offsets.range(cursor, to), "semconvText", 0);
          return;
        }
      }

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

/**
 * Tokens for a markdown doc: the semconv ids inside `<!-- weaver ... -->` snippet
 * queries, highlighted as references (single-line, like the YAML refs they mirror).
 */
export function buildMarkdownSemanticTokens(
  refs: Reference[],
  unresolved: Set<Reference>,
): SemanticTokens {
  const builder = new SemanticTokensBuilder();
  const sorted = [...refs].sort(
    (a, b) =>
      a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character,
  );
  for (const ref of sorted) {
    const { start, end } = ref.range;
    if (start.line !== end.line) continue;
    const mods = unresolved.has(ref) ? UNRESOLVED : 0;
    builder.push(
      start.line,
      start.character,
      end.character - start.character,
      TYPE_INDEX[REF_TOKEN[ref.refKind]],
      mods,
    );
  }
  return builder.build();
}
