import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { extract } from "../model";

const REG = path.join(process.cwd(), "test/fixtures/registry");

function read(name: string): { text: string; uri: string } {
  const file = path.join(REG, name);
  return { text: fs.readFileSync(file, "utf8"), uri: `file://${file}` };
}

function tokenText(text: string, range: { start: any; end: any }): string {
  const lines = text.split("\n");
  if (range.start.line === range.end.line) {
    return lines[range.start.line].slice(range.start.character, range.end.character);
  }
  return text;
}

describe("extract – definitions", () => {
  it("detects definition/2 and extracts attribute defs incl. enum members", () => {
    const { text, uri } = read("registry.yaml");
    const { isSemconv, defs } = extract(text, uri);

    expect(isSemconv).toBe(true);

    const provider = defs.find((d) => d.kind === "attribute" && d.id === "gen_ai.provider.name");
    expect(provider).toBeDefined();
    expect(provider!.type).toBe("enum");
    expect(provider!.stability).toBe("development");
    expect(tokenText(text, provider!.nameRange)).toBe("gen_ai.provider.name");

    const port = defs.find((d) => d.id === "server.port");
    expect(port?.type).toBe("int");

    const members = defs.filter((d) => d.kind === "enum_member");
    expect(members.map((m) => m.id)).toEqual(
      expect.arrayContaining(["gen_ai.provider.name.openai", "gen_ai.provider.name.anthropic"]),
    );
  });

  it("extracts groups, spans and refinements with precise name ranges", () => {
    const { text, uri } = read("spans.yaml");
    const { defs } = extract(text, uri);

    const group = defs.find((d) => d.kind === "attribute_group");
    expect(group?.id).toBe("attributes.gen_ai.common");

    const span = defs.find((d) => d.kind === "span");
    expect(span?.id).toBe("gen_ai.inference.client");
    expect(tokenText(text, span!.nameRange)).toBe("gen_ai.inference.client");

    const refinement = defs.find((d) => d.kind === "span_refinement");
    expect(refinement?.id).toBe("openai.inference.client");
  });
});

describe("extract – references", () => {
  it("captures ref, ref_group, entity_associations and refinement refs", () => {
    const { text, uri } = read("spans.yaml");
    const { refs } = extract(text, uri);

    const byKind = (k: string) => refs.filter((r) => r.refKind === k).map((r) => r.id);

    expect(byKind("group_ref")).toEqual(
      expect.arrayContaining(["attributes.gen_ai.common", "attributes.gen_ai.address_and_port"]),
    );
    expect(byKind("attribute_ref")).toEqual(expect.arrayContaining(["gen_ai.provider.name"]));
    expect(byKind("entity_assoc")).toEqual(["gen_ai.agent"]);
    expect(byKind("span_refinement_ref")).toEqual(["gen_ai.inference.client"]);

    const providerRef = refs.find(
      (r) => r.refKind === "attribute_ref" && r.id === "gen_ai.provider.name",
    );
    expect(tokenText(text, providerRef!.range)).toBe("gen_ai.provider.name");
  });

  it("returns isSemconv=false for non-semconv yaml", () => {
    const res = extract("foo: bar\n", "file:///x.yaml");
    expect(res.isSemconv).toBe(false);
    expect(res.defs).toHaveLength(0);
  });
});
