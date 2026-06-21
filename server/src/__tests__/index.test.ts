import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { RegistryIndex } from "../index";
import { extract } from "../model";

const REG = path.join(process.cwd(), "test/fixtures/registry");
const DIAG = path.join(process.cwd(), "test/fixtures/diagnostics");
const uriOf = (name: string) => `file://${path.join(REG, name)}`;

function buildIndex(): RegistryIndex {
  const idx = new RegistryIndex();
  for (const name of ["registry.yaml", "entities.yaml", "spans.yaml"]) {
    const text = fs.readFileSync(path.join(REG, name), "utf8");
    const { defs, refs, hasImports } = extract(text, uriOf(name));
    idx.setDocument(uriOf(name), defs, refs, hasImports);
  }
  return idx;
}

// The deliberately broken ref lives outside the (weaver-validated) registry; its
// resolvable refs still resolve against the registry once both are indexed.
function indexDiagnosticsFixture(idx: RegistryIndex): string {
  const uri = `file://${path.join(DIAG, "unresolved.yaml")}`;
  const text = fs.readFileSync(path.join(DIAG, "unresolved.yaml"), "utf8");
  const { defs, refs, hasImports } = extract(text, uri);
  idx.setDocument(uri, defs, refs, hasImports);
  return uri;
}

describe("RegistryIndex – cross-file resolution", () => {
  it("resolves ref -> attribute definition", () => {
    const idx = buildIndex();
    const defs = idx.definitionsFor("gen_ai.provider.name", ["attribute"]);
    expect(defs).toHaveLength(1);
    expect(defs[0].uri).toBe(uriOf("registry.yaml"));
  });

  it("resolves ref_group -> attribute_group definition", () => {
    const idx = buildIndex();
    expect(idx.definitionsFor("attributes.gen_ai.common", ["attribute_group"])).toHaveLength(1);
  });

  it("resolves entity_associations -> entity definition", () => {
    const idx = buildIndex();
    expect(idx.definitionsFor("gen_ai.agent", ["entity"])).toHaveLength(1);
  });

  it("resolves span_refinement ref -> span definition", () => {
    const idx = buildIndex();
    expect(idx.definitionsFor("gen_ai.inference.client", ["span"])).toHaveLength(1);
  });

  it("find-references returns every ref to an attribute across files", () => {
    const idx = buildIndex();
    const refs = idx.referencesFor("gen_ai.provider.name", "attribute");
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(refs.map((r) => r.uri))).toEqual(
      new Set([uriOf("entities.yaml"), uriOf("spans.yaml")]),
    );
  });
});

describe("RegistryIndex – symbolAt", () => {
  it("locates a reference token and a definition token", () => {
    const idx = buildIndex();

    const spansText = fs.readFileSync(path.join(REG, "spans.yaml"), "utf8");
    const { refs } = extract(spansText, uriOf("spans.yaml"));
    const providerRef = refs.find((r) => r.id === "gen_ai.provider.name")!;

    const sym = idx.symbolAt(uriOf("spans.yaml"), providerRef.range.start);
    expect(sym?.kind).toBe("reference");
    if (sym?.kind === "reference") expect(sym.ref.id).toBe("gen_ai.provider.name");

    const regText = fs.readFileSync(path.join(REG, "registry.yaml"), "utf8");
    const { defs } = extract(regText, uriOf("registry.yaml"));
    const providerDef = defs.find(
      (d) => d.kind === "attribute" && d.id === "gen_ai.provider.name",
    )!;
    const symDef = idx.symbolAt(uriOf("registry.yaml"), providerDef.nameRange.start);
    expect(symDef?.kind).toBe("definition");
  });
});

describe("RegistryIndex – symbol queries", () => {
  it("allDefinitions spans every file and invalidates on removeDocument", () => {
    const idx = buildIndex();
    const ids = new Set(idx.allDefinitions().map((d) => d.id));
    expect(ids).toContain("gen_ai.provider.name"); // registry.yaml
    expect(ids).toContain("gen_ai.inference.client"); // spans.yaml

    idx.removeDocument(uriOf("spans.yaml"));
    expect(idx.allDefinitions().map((d) => d.id)).not.toContain("gen_ai.inference.client");
  });

  it("documentSymbols caches per file and rebuilds after re-index", () => {
    const idx = buildIndex();
    const first = idx.documentSymbols(uriOf("registry.yaml"));
    expect(first).toBe(idx.documentSymbols(uriOf("registry.yaml")));
    expect(first.some((s) => s.name === "gen_ai.provider.name")).toBe(true);

    const text = fs.readFileSync(path.join(REG, "registry.yaml"), "utf8");
    const { defs, refs, hasImports } = extract(text, uriOf("registry.yaml"));
    idx.setDocument(uriOf("registry.yaml"), defs, refs, hasImports);
    expect(idx.documentSymbols(uriOf("registry.yaml"))).not.toBe(first);
  });
});

describe("RegistryIndex – diagnostics rules", () => {
  it("flags an unresolved reference in a self-contained registry", () => {
    const idx = buildIndex();
    const diag = indexDiagnosticsFixture(idx);
    const unresolved = idx.unresolvedReferences(diag);
    expect(unresolved.map((r) => r.id)).toContain("gen_ai.does.not.exist");
    expect(unresolved.map((r) => r.id)).not.toContain("gen_ai.provider.name");
  });

  it("suppresses unresolved diagnostics when any registry file imports", () => {
    const idx = buildIndex();
    const diag = indexDiagnosticsFixture(idx);
    expect(idx.unresolvedReferences(diag).length).toBeGreaterThan(0);
    idx.setDocument(uriOf("imports.yaml"), [], [], /* hasImports */ true);
    expect(idx.unresolvedReferences(diag)).toHaveLength(0);
  });

  it("detects duplicate definitions", () => {
    const idx = buildIndex();
    const text = fs.readFileSync(path.join(REG, "registry.yaml"), "utf8");
    const { defs, refs, hasImports } = extract(text, uriOf("registry-copy.yaml"));
    idx.setDocument(uriOf("registry-copy.yaml"), defs, refs, hasImports);

    const dups = idx.duplicateDefinitions(uriOf("registry-copy.yaml"));
    expect(dups.map((d) => d.id)).toContain("gen_ai.provider.name");
  });

  it("removeDocument retracts its definitions", () => {
    const idx = buildIndex();
    idx.removeDocument(uriOf("registry.yaml"));
    expect(idx.definitionsFor("gen_ai.provider.name", ["attribute"])).toHaveLength(0);
  });
});
