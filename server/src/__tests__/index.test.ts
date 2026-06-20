import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extract } from '../model';
import { RegistryIndex } from '../index';

const REG = path.join(process.cwd(), 'test/fixtures/registry');
const uriOf = (name: string) => `file://${path.join(REG, name)}`;

function buildIndex(): RegistryIndex {
  const idx = new RegistryIndex();
  for (const name of ['registry.yaml', 'entities.yaml', 'spans.yaml']) {
    const text = fs.readFileSync(path.join(REG, name), 'utf8');
    const { defs, refs, hasImports } = extract(text, uriOf(name));
    idx.setDocument(uriOf(name), defs, refs, hasImports);
  }
  return idx;
}

describe('RegistryIndex – cross-file resolution', () => {
  it('resolves ref -> attribute definition', () => {
    const idx = buildIndex();
    const defs = idx.definitionsFor('gen_ai.provider.name', ['attribute']);
    expect(defs).toHaveLength(1);
    expect(defs[0].uri).toBe(uriOf('registry.yaml'));
  });

  it('resolves ref_group -> attribute_group definition', () => {
    const idx = buildIndex();
    expect(idx.definitionsFor('attributes.gen_ai.common', ['attribute_group'])).toHaveLength(1);
  });

  it('resolves entity_associations -> entity definition', () => {
    const idx = buildIndex();
    expect(idx.definitionsFor('gen_ai.agent', ['entity'])).toHaveLength(1);
  });

  it('resolves span_refinement ref -> span definition', () => {
    const idx = buildIndex();
    expect(idx.definitionsFor('gen_ai.inference.client', ['span'])).toHaveLength(1);
  });

  it('find-references returns every ref to an attribute across files', () => {
    const idx = buildIndex();
    const refs = idx.referencesFor('gen_ai.provider.name', 'attribute');
    // referenced once from entities.yaml and once from spans.yaml.
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(refs.map((r) => r.uri))).toEqual(
      new Set([uriOf('entities.yaml'), uriOf('spans.yaml')])
    );
  });
});

describe('RegistryIndex – symbolAt', () => {
  it('locates a reference token and a definition token', () => {
    const idx = buildIndex();

    // Find the provider ref range from a fresh extract to get its position.
    const spansText = fs.readFileSync(path.join(REG, 'spans.yaml'), 'utf8');
    const { refs } = extract(spansText, uriOf('spans.yaml'));
    const providerRef = refs.find((r) => r.id === 'gen_ai.provider.name')!;

    const sym = idx.symbolAt(uriOf('spans.yaml'), providerRef.range.start);
    expect(sym?.kind).toBe('reference');
    if (sym?.kind === 'reference') expect(sym.ref.id).toBe('gen_ai.provider.name');

    const regText = fs.readFileSync(path.join(REG, 'registry.yaml'), 'utf8');
    const { defs } = extract(regText, uriOf('registry.yaml'));
    const providerDef = defs.find((d) => d.kind === 'attribute' && d.id === 'gen_ai.provider.name')!;
    const symDef = idx.symbolAt(uriOf('registry.yaml'), providerDef.nameRange.start);
    expect(symDef?.kind).toBe('definition');
  });
});

describe('RegistryIndex – diagnostics rules', () => {
  it('flags an unresolved reference in a self-contained registry', () => {
    const idx = buildIndex();
    const unresolved = idx.unresolvedReferences(uriOf('spans.yaml'));
    expect(unresolved.map((r) => r.id)).toContain('gen_ai.does.not.exist');
    // The valid refs must NOT be flagged.
    expect(unresolved.map((r) => r.id)).not.toContain('gen_ai.provider.name');
  });

  it('suppresses unresolved diagnostics when any registry file imports', () => {
    const idx = buildIndex();
    // A registry that imports ids from elsewhere: id universe is unknown.
    idx.setDocument(uriOf('imports.yaml'), [], [], /* hasImports */ true);
    expect(idx.unresolvedReferences(uriOf('spans.yaml'))).toHaveLength(0);
  });

  it('detects duplicate definitions', () => {
    const idx = buildIndex();
    // Re-add registry content under a second uri -> every attribute now duplicated.
    const text = fs.readFileSync(path.join(REG, 'registry.yaml'), 'utf8');
    const { defs, refs, hasImports } = extract(text, uriOf('registry-copy.yaml'));
    idx.setDocument(uriOf('registry-copy.yaml'), defs, refs, hasImports);

    const dups = idx.duplicateDefinitions(uriOf('registry-copy.yaml'));
    expect(dups.map((d) => d.id)).toContain('gen_ai.provider.name');
  });

  it('removeDocument retracts its definitions', () => {
    const idx = buildIndex();
    idx.removeDocument(uriOf('registry.yaml'));
    expect(idx.definitionsFor('gen_ai.provider.name', ['attribute'])).toHaveLength(0);
  });
});
