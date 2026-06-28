import { DocumentSymbol, Position } from "vscode-languageserver";

import { buildDocumentSymbols } from "./document-symbols";
import { positionInRange } from "./parser";
import { Definition, DefKind, Reference, RESOLUTION, SymbolAt } from "./types";

interface DocEntry {
  defs: Definition[];
  refs: Reference[];
  proseRefs: Reference[];
  hasImports: boolean;
  symbols?: DocumentSymbol[];
}

export class RegistryIndex {
  private readonly docs = new Map<string, DocEntry>();
  private readonly defIndex = new Map<string, Definition[]>();
  private readonly refIndex = new Map<string, Reference[]>();
  private readonly proseRefIndex = new Map<string, Reference[]>();
  private importingDocs = 0;
  private allDefsCache: Definition[] | undefined;
  private searchCache: { def: Definition; lowerId: string }[] | undefined;

  setDocument(
    uri: string,
    defs: Definition[],
    refs: Reference[],
    proseRefs: Reference[],
    hasImports: boolean,
  ): void {
    this.removeDocument(uri);
    this.docs.set(uri, { defs, refs, proseRefs, hasImports });
    if (hasImports) this.importingDocs++;
    for (const def of defs) push(this.defIndex, def.id, def);
    for (const ref of refs) push(this.refIndex, ref.id, ref);
    for (const ref of proseRefs) push(this.proseRefIndex, ref.id, ref);
    this.allDefsCache = undefined;
    this.searchCache = undefined;
  }

  removeDocument(uri: string): void {
    const entry = this.docs.get(uri);
    if (!entry) return;
    if (entry.hasImports) this.importingDocs--;
    for (const def of entry.defs) remove(this.defIndex, def.id, (d) => d.uri === uri);
    for (const ref of entry.refs) remove(this.refIndex, ref.id, (r) => r.uri === uri);
    for (const ref of entry.proseRefs) remove(this.proseRefIndex, ref.id, (r) => r.uri === uri);
    this.docs.delete(uri);
    this.allDefsCache = undefined;
    this.searchCache = undefined;
  }

  has(uri: string): boolean {
    return this.docs.has(uri);
  }

  documentUris(): string[] {
    return Array.from(this.docs.keys());
  }

  definitionsFor(id: string, kinds: readonly DefKind[]): Definition[] {
    const all = this.defIndex.get(id) ?? [];
    return all.filter((d) => kinds.includes(d.kind));
  }

  /** Prose mentions in `uri` that resolve to a real definition (the rest are just prose). */
  resolvedProseRefs(uri: string): Reference[] {
    const entry = this.docs.get(uri);
    if (!entry) return [];
    return entry.proseRefs.filter((r) => this.defIndex.has(r.id));
  }

  allDefinitions(): Definition[] {
    return (this.allDefsCache ??= Array.from(this.defIndex.values()).flat());
  }

  searchDefinitions(query: string, limit: number): Definition[] {
    const cache = (this.searchCache ??= this.allDefinitions().map((def) => ({
      def,
      lowerId: def.id.toLowerCase(),
    })));
    const q = query.toLowerCase();
    const out: Definition[] = [];
    for (const { def, lowerId } of cache) {
      if (q && !lowerId.includes(q)) continue;
      out.push(def);
      if (out.length >= limit) break;
    }
    return out;
  }

  documentSymbols(uri: string): DocumentSymbol[] {
    const entry = this.docs.get(uri);
    if (!entry) return [];
    return (entry.symbols ??= buildDocumentSymbols(entry.defs));
  }

  referencesFor(id: string, defKind?: DefKind): Reference[] {
    const all = [...(this.refIndex.get(id) ?? []), ...(this.proseRefIndex.get(id) ?? [])];
    if (!defKind) return all;
    return all.filter((r) => RESOLUTION[r.refKind].includes(defKind));
  }

  symbolAt(uri: string, position: Position): SymbolAt | undefined {
    const entry = this.docs.get(uri);
    if (!entry) return undefined;
    for (const def of entry.defs) {
      if (positionInRange(def.nameRange, position)) return { kind: "definition", def };
    }
    for (const ref of entry.refs) {
      if (positionInRange(ref.range, position)) return { kind: "reference", ref };
    }
    // A prose mention is a symbol only where it resolves; unresolved wrapped text
    // stays invisible to navigation/hover.
    for (const ref of entry.proseRefs) {
      if (positionInRange(ref.range, position) && this.defIndex.has(ref.id)) {
        return { kind: "reference", ref };
      }
    }
    return undefined;
  }

  localSymbols(uri: string): { defs: Definition[]; refs: Reference[] } {
    const entry = this.docs.get(uri);
    return entry ? { defs: entry.defs, refs: entry.refs } : { defs: [], refs: [] };
  }

  unresolvedReferences(uri: string): Reference[] {
    // An importing registry pulls ids from elsewhere, so the local id set is
    // incomplete and "unresolved" can't be determined — suppress entirely.
    if (this.importingDocs > 0) return [];
    const entry = this.docs.get(uri);
    if (!entry) return [];
    const unresolved = entry.refs.filter(
      (ref) => this.definitionsFor(ref.id, RESOLUTION[ref.refKind]).length === 0,
    );
    // A prose mention resolves against every definition kind, so it's unresolved
    // exactly when no definition carries its id.
    for (const ref of entry.proseRefs) {
      if (!this.defIndex.has(ref.id)) unresolved.push(ref);
    }
    return unresolved;
  }

  duplicateDefinitions(uri: string): Definition[] {
    const entry = this.docs.get(uri);
    if (!entry) return [];
    // With imports the workspace composes independent registries, so a shared id
    // across files isn't a real duplicate — restrict the check to within this file.
    const crossFile = this.importingDocs === 0;
    return entry.defs.filter((def) => {
      const peers = crossFile ? (this.defIndex.get(def.id) ?? []) : entry.defs;
      return peers.filter((p) => p.id === def.id && p.kind === def.kind).length > 1;
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
