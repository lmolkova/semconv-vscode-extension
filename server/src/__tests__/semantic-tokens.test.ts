import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { RegistryIndex } from "../index";
import { extractMarkdown } from "../markdown";
import { extract } from "../model";
import { parseSemconv } from "../parser";
import {
  buildMarkdownSemanticTokens,
  buildSemanticTokens,
  semanticTokensLegend,
} from "../semantic-tokens";

const REG = path.join(process.cwd(), "test/fixtures/registry");

interface Token {
  line: number;
  char: number;
  length: number;
  type: string;
  mods: string[];
}

/** Build tokens for one doc, wiring an index from every supplied doc so refs resolve. */
function tokensFor(target: string, docs: Record<string, string>): Token[] {
  const index = new RegistryIndex();
  for (const [name, text] of Object.entries(docs)) {
    const uri = `file://${name}`;
    const { isSemconv, defs, refs, proseRefs, hasImports } = extract(text, uri);
    if (isSemconv) index.setDocument(uri, defs, refs, proseRefs, hasImports);
  }
  const uri = `file://${target}`;
  const { defs, refs } = index.localSymbols(uri);
  const unresolved = new Set(index.unresolvedReferences(uri));
  const proseRefs = index.resolvedProseRefs(uri);
  const encoded = buildSemanticTokens(
    parseSemconv(docs[target]),
    defs,
    refs,
    unresolved,
    proseRefs,
  );
  return decode(encoded.data);
}

function decode(data: number[]): Token[] {
  const out: Token[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaChar = data[i + 1];
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;
    out.push({
      line,
      char,
      length: data[i + 2],
      type: semanticTokensLegend.tokenTypes[data[i + 3]],
      mods: semanticTokensLegend.tokenModifiers.filter((_, b) => (data[i + 4] >> b) & 1),
    });
  }
  return out;
}

function read(name: string): string {
  return fs.readFileSync(path.join(REG, name), "utf8");
}

/** Token covering the start of the nth (0-based) occurrence of `needle`. */
function at(text: string, tokens: Token[], needle: string, nth = 0): Token | undefined {
  let idx = -1;
  for (let i = 0; i <= nth; i++) idx = text.indexOf(needle, idx + 1);
  const before = text.slice(0, idx);
  const line = before.split("\n").length - 1;
  const char = idx - (before.lastIndexOf("\n") + 1);
  return tokens.find((t) => t.line === line && t.char === char);
}

describe("buildSemanticTokens", () => {
  it("marks attribute definitions, enum members, and enum values", () => {
    const registry = read("registry.yaml");
    const tokens = tokensFor("registry.yaml", { "registry.yaml": registry });

    expect(at(registry, tokens, "gen_ai.provider.name")).toMatchObject({
      type: "semconvDefinition",
      mods: [],
    });
    expect(at(registry, tokens, "server.port")).toMatchObject({ type: "semconvDefinition" });
    expect(at(registry, tokens, "openai", 0)).toMatchObject({
      type: "semconvEnumMember",
      mods: [],
    });
    // `stability: development` is a closed-enum value.
    expect(at(registry, tokens, "development")).toMatchObject({
      type: "semconvEnumValue",
      mods: [],
    });
  });

  it("colors groups/spans and their resolved references alike", () => {
    const docs = { "spans.yaml": read("spans.yaml"), "registry.yaml": read("registry.yaml") };
    const spans = docs["spans.yaml"];
    const tokens = tokensFor("spans.yaml", docs);

    expect(at(spans, tokens, "attributes.gen_ai.common", 0)).toMatchObject({
      type: "semconvDefinition",
      mods: [],
    });
    expect(at(spans, tokens, "attributes.gen_ai.common", 1)).toMatchObject({
      type: "semconvReference",
      mods: [],
    });
    expect(at(spans, tokens, "gen_ai.inference.client", 0)).toMatchObject({
      type: "semconvDefinition",
      mods: [],
    });
    expect(at(spans, tokens, "openai.inference.client")).toMatchObject({
      type: "semconvDefinition",
      mods: [],
    });
    // span_refinement ref resolves to the span def in the same file.
    expect(at(spans, tokens, "gen_ai.inference.client", 1)).toMatchObject({
      type: "semconvReference",
    });
  });

  it("flags references with no definition via the unresolved modifier", () => {
    const doc = `file_format: definition/2
attribute_groups:
  - id: g
    attributes:
      - ref: does.not.exist
`;
    const tokens = tokensFor("a.yaml", { "a.yaml": doc });
    expect(at(doc, tokens, "does.not.exist")).toMatchObject({
      type: "semconvReference",
      mods: ["unresolved"],
    });
  });

  it("highlights enum values and plain text in manifests, but no symbol tokens", () => {
    const manifest = read("manifest.yaml");
    const tokens = tokensFor("manifest.yaml", { "manifest.yaml": manifest });
    expect(at(manifest, tokens, "development")).toMatchObject({ type: "semconvEnumValue" });
    expect(at(manifest, tokens, "https://")).toMatchObject({ type: "semconvSchemaUrl" });
    const symbolTypes = new Set(["semconvDefinition", "semconvReference", "semconvEnumMember"]);
    expect(tokens.some((t) => symbolTypes.has(t.type))).toBe(false);
  });

  it("colors multi-line notes and sequence examples as plain text", () => {
    const doc = `file_format: definition/2
attributes:
  - key: gen_ai.evaluation.score.label
    type: string
    stability: development
    brief: Human readable label for evaluation.
    note: >
      This attribute provides a human-readable interpretation.
      The label SHOULD have low cardinality.
    examples: ["relevant", "not_relevant"]
`;
    const tokens = tokensFor("a.yaml", { "a.yaml": doc });

    expect(at(doc, tokens, "Human readable")).toMatchObject({ type: "semconvText" });
    // every physical line of the folded note carries its own token (tokens can't span lines)
    const noteLines = [7, 8];
    for (const line of noteLines) {
      expect(tokens.find((t) => t.line === line)).toMatchObject({ type: "semconvText" });
    }
    expect(at(doc, tokens, '"relevant"')).toMatchObject({ type: "semconvText" });
    expect(at(doc, tokens, '"not_relevant"')).toMatchObject({ type: "semconvText" });
  });

  it("returns nothing for plain yaml", () => {
    const tokens = tokensFor("plain.yaml", { "plain.yaml": "foo: bar\n" });
    expect(tokens).toEqual([]);
  });

  it("highlights resolved prose mentions in brief/note, leaving unknown ones as text", () => {
    const reg = `file_format: definition/2
attributes:
  - key: a.b
    type: string
    stability: development
    brief: See \`a.b\` and {a.b}; not \`a.unknown\` nor \`a.b.c\`.
`;
    const tokens = tokensFor("reg.yaml", { "reg.yaml": reg });
    // `a.b` and {a.b} resolve to the attribute → references (nth 0 is the `key:` def).
    expect(at(reg, tokens, "a.b", 1)).toMatchObject({ type: "semconvReference", mods: [] });
    expect(at(reg, tokens, "a.b", 2)).toMatchObject({ type: "semconvReference", mods: [] });
    // Exactly those two: unknown ids (`a.unknown`, `a.b.c`) stay plain prose, unflagged.
    const refs = tokens.filter((t) => t.type === "semconvReference");
    expect(refs).toHaveLength(2);
    expect(refs.every((t) => t.length === 3)).toBe(true);
    // The surrounding words are still plain text.
    expect(at(reg, tokens, "See")).toMatchObject({ type: "semconvText" });
  });
});

describe("buildMarkdownSemanticTokens", () => {
  function mdTokens(text: string, docs: Record<string, string>): Token[] {
    const index = new RegistryIndex();
    for (const [name, doc] of Object.entries(docs)) {
      const { isSemconv, defs, refs, proseRefs, hasImports } = extract(doc, `file://${name}`);
      if (isSemconv) index.setDocument(`file://${name}`, defs, refs, proseRefs, hasImports);
    }
    const uri = "file://doc.md";
    const refs = extractMarkdown(text, uri);
    index.setDocument(uri, [], refs, [], false);
    return decode(buildMarkdownSemanticTokens(refs, new Set(index.unresolvedReferences(uri))).data);
  }

  const md = `<!-- weaver registry attributes --filter '.key == "a.b"' -->
<!-- endweaver -->
<!-- weaver registry attributes --filter '.key == "a.missing"' -->
<!-- endweaver -->
`;

  it("highlights weaver query ids as references, flagging unresolved ones", () => {
    const reg = `file_format: definition/2
attributes:
  - key: a.b
    type: string
    stability: development
    brief: x
`;
    const tokens = mdTokens(md, { "reg.yaml": reg });
    expect(at(md, tokens, "a.b")).toMatchObject({ type: "semconvReference", mods: [] });
    expect(at(md, tokens, "a.missing")).toMatchObject({
      type: "semconvReference",
      mods: ["unresolved"],
    });
  });
});
