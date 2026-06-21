import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { SymbolKind, SymbolTag } from "vscode-languageserver";

import { buildDocumentSymbols } from "../document-symbols";
import { extract } from "../model";
import { Definition } from "../types";

const REG = path.join(process.cwd(), "test/fixtures/registry");
function read(name: string) {
  const file = path.join(REG, name);
  return { text: fs.readFileSync(file, "utf8"), uri: `file://${file}` };
}

describe("buildDocumentSymbols", () => {
  it("nests enum members under their attribute and not at top level", () => {
    const { text, uri } = read("registry.yaml");
    const symbols = buildDocumentSymbols(extract(text, uri).defs);

    const provider = symbols.find((s) => s.name === "gen_ai.provider.name");
    expect(provider?.kind).toBe(SymbolKind.Field);
    expect(provider?.children?.map((c) => c.name)).toEqual([
      "gen_ai.provider.name.openai",
      "gen_ai.provider.name.anthropic",
    ]);
    expect(provider?.children?.every((c) => c.kind === SymbolKind.EnumMember)).toBe(true);

    expect(symbols.some((s) => s.name.startsWith("gen_ai.provider.name."))).toBe(false);
  });

  it("uses fullRange for range and the id token for selectionRange", () => {
    const { text, uri } = read("registry.yaml");
    const defs = extract(text, uri).defs;
    const symbols = buildDocumentSymbols(defs);

    const def = defs.find((d) => d.kind === "attribute" && d.id === "gen_ai.provider.name")!;
    const symbol = symbols.find((s) => s.name === "gen_ai.provider.name")!;
    expect(symbol.range).toEqual(def.fullRange);
    expect(symbol.selectionRange).toEqual(def.nameRange);
  });

  it("maps signal kinds for groups, spans and refinements", () => {
    const { text, uri } = read("spans.yaml");
    const symbols = buildDocumentSymbols(extract(text, uri).defs);

    expect(symbols.find((s) => s.name === "attributes.gen_ai.common")?.kind).toBe(
      SymbolKind.Namespace,
    );
    expect(symbols.find((s) => s.name === "gen_ai.inference.client")?.kind).toBe(SymbolKind.Method);
    expect(symbols.find((s) => s.name === "openai.inference.client")?.kind).toBe(
      SymbolKind.Interface,
    );
  });

  it("tags deprecated definitions", () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    const defs: Definition[] = [
      {
        kind: "attribute",
        id: "gen_ai.legacy",
        uri: "file:///x.yaml",
        nameRange: range,
        fullRange: range,
        stability: "deprecated",
      },
    ];
    expect(buildDocumentSymbols(defs)[0].tags).toEqual([SymbolTag.Deprecated]);
  });
});
