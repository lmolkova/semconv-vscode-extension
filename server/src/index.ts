import { Position, Range } from "vscode-languageserver";

import { Definition, DefKind, Reference, RESOLUTION, SymbolAt } from "./types";

interface DocEntry {
  defs: Definition[];
  refs: Reference[];
  hasImports: boolean;
}

export class RegistryIndex {
  private readonly docs = new Map<string, DocEntry>();
  private readonly defIndex = new Map<string, Definition[]>();
  private readonly refIndex = new Map<string, Reference[]>();
  private importingDocs = 0;

  setDocument(uri: string, defs: Definition[], refs: Reference[], hasImports: boolean): void {
    this.removeDocument(uri);
    this.docs.set(uri, { defs, refs, hasImports });
    if (hasImports) this.importingDocs++;
    for (const def of defs) push(this.defIndex, def.id, def);
    for (const ref of refs) push(this.refIndex, ref.id, ref);
  }

  removeDocument(uri: string): void {
    const entry = this.docs.get(uri);
    if (!entry) return;
    if (entry.hasImports) this.importingDocs--;
    for (const def of entry.defs) remove(this.defIndex, def.id, (d) => d.uri === uri);
    for (const ref of entry.refs) remove(this.refIndex, ref.id, (r) => r.uri === uri);
    this.docs.delete(uri);
  }

  has(uri: string): boolean {
    return this.docs.has(uri);
  }

  definitionsFor(id: string, kinds: readonly DefKind[]): Definition[] {
    const all = this.defIndex.get(id) ?? [];
    return all.filter((d) => kinds.includes(d.kind));
  }

  referencesFor(id: string, defKind?: DefKind): Reference[] {
    const all = this.refIndex.get(id) ?? [];
    if (!defKind) return all;
    return all.filter((r) => RESOLUTION[r.refKind].includes(defKind));
  }

  symbolAt(uri: string, position: Position): SymbolAt | undefined {
    const entry = this.docs.get(uri);
    if (!entry) return undefined;
    for (const def of entry.defs) {
      if (contains(def.nameRange, position)) return { kind: "definition", def };
    }
    for (const ref of entry.refs) {
      if (contains(ref.range, position)) return { kind: "reference", ref };
    }
    return undefined;
  }

  unresolvedReferences(uri: string): Reference[] {
    // An importing registry pulls ids from elsewhere, so the local id set is
    // incomplete and "unresolved" can't be determined — suppress entirely.
    if (this.importingDocs > 0) return [];
    const entry = this.docs.get(uri);
    if (!entry) return [];
    return entry.refs.filter(
      (ref) => this.definitionsFor(ref.id, RESOLUTION[ref.refKind]).length === 0,
    );
  }

  duplicateDefinitions(uri: string): Definition[] {
    const entry = this.docs.get(uri);
    if (!entry) return [];
    return entry.defs.filter((def) => {
      const peers = this.defIndex.get(def.id) ?? [];
      return peers.filter((p) => p.kind === def.kind).length > 1;
    });
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function remove<T>(map: Map<string, T[]>, key: string, pred: (v: T) => boolean): void {
  const arr = map.get(key);
  if (!arr) return;
  const kept = arr.filter((v) => !pred(v));
  if (kept.length) map.set(key, kept);
  else map.delete(key);
}

function contains(range: Range, pos: Position): boolean {
  const afterStart =
    pos.line > range.start.line ||
    (pos.line === range.start.line && pos.character >= range.start.character);
  const beforeEnd =
    pos.line < range.end.line ||
    (pos.line === range.end.line && pos.character <= range.end.character);
  return afterStart && beforeEnd;
}
