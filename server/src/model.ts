import { isMap, isSeq, YAMLMap, YAMLSeq, Scalar } from 'yaml';
import { Definition, Reference, DefKind, RefKind } from './types';
import { OffsetConverter, parseSemconv, readScalar, scalarNode } from './parser';

export interface ExtractResult {
  isSemconv: boolean;
  defs: Definition[];
  refs: Reference[];
  /**
   * True when the document pulls ids from other registries (an `imports`
   * section). Such ids are not locally defined, so the server must not flag
   * unresolved references in registries that import.
   */
  hasImports: boolean;
}

/** Top-level signal arrays whose items are definitions, with their id field. */
const SIGNAL_DEFS: { array: string; idField: string; kind: DefKind }[] = [
  { array: 'attribute_groups', idField: 'id', kind: 'attribute_group' },
  { array: 'entities', idField: 'type', kind: 'entity' },
  { array: 'events', idField: 'name', kind: 'event' },
  { array: 'metrics', idField: 'name', kind: 'metric' },
  { array: 'spans', idField: 'type', kind: 'span' }
];

/** Top-level refinement arrays: each item has its own `id` and a `ref`. */
const REFINEMENTS: { array: string; defKind: DefKind; refKind: RefKind }[] = [
  { array: 'entity_refinements', defKind: 'entity_refinement', refKind: 'entity_refinement_ref' },
  { array: 'event_refinements', defKind: 'event_refinement', refKind: 'event_refinement_ref' },
  { array: 'metric_refinements', defKind: 'metric_refinement', refKind: 'metric_refinement_ref' },
  { array: 'span_refinements', defKind: 'span_refinement', refKind: 'span_refinement_ref' }
];

/** Parse + extract all definitions and references from a document's text. */
export function extract(text: string, uri: string): ExtractResult {
  const parsed = parseSemconv(text);
  const defs: Definition[] = [];
  const refs: Reference[] = [];

  if (!parsed.isSemconv || !parsed.root) {
    return { isSemconv: false, defs, refs, hasImports: false };
  }

  const root = parsed.root;
  const off = parsed.offsets;
  const ctx = { off, uri, defs, refs };

  extractAttributeDefs(root, ctx);
  for (const spec of SIGNAL_DEFS) {
    extractSignalDefs(root, spec.array, spec.idField, spec.kind, ctx);
  }
  for (const spec of REFINEMENTS) {
    extractRefinements(root, spec.array, spec.defKind, spec.refKind, ctx);
  }

  return { isSemconv: true, defs, refs, hasImports: root.has('imports') };
}

interface Ctx {
  off: OffsetConverter;
  uri: string;
  defs: Definition[];
  refs: Reference[];
}

function seq(map: YAMLMap, key: string): YAMLSeq | undefined {
  const node = map.get(key, true);
  return isSeq(node) ? (node as YAMLSeq) : undefined;
}

function mapItems(s: YAMLSeq | undefined): YAMLMap[] {
  if (!s) return [];
  return s.items.filter(isMap) as YAMLMap[];
}

/** Build a Range covering a scalar token (start..valueEnd of its source range). */
function tokenRange(node: Scalar, off: OffsetConverter) {
  const r = node.range;
  if (!r) {
    return Range0;
  }
  return off.range(r[0], r[1]);
}

const Range0 = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 }
};

function makeDef(map: YAMLMap, idField: string, kind: DefKind, ctx: Ctx): Definition | undefined {
  const idNode = scalarNode(map, idField);
  if (!idNode || typeof idNode.value !== 'string') return undefined;
  const full = map.range ? ctx.off.range(map.range[0], map.range[2]) : tokenRange(idNode, ctx.off);
  return {
    kind,
    id: idNode.value,
    uri: ctx.uri,
    nameRange: tokenRange(idNode, ctx.off),
    fullRange: full,
    brief: readScalar(map, 'brief'),
    stability: readScalar(map, 'stability')
  };
}

/** Top-level `attributes:` — each item defines an attribute (`key`) + enum members. */
function extractAttributeDefs(root: YAMLMap, ctx: Ctx): void {
  for (const item of mapItems(seq(root, 'attributes'))) {
    const def = makeDef(item, 'key', 'attribute', ctx);
    if (!def) continue;
    def.type = attributeTypeLabel(item);
    ctx.defs.push(def);
    extractEnumMembers(item, def.id, ctx);
  }
}

function attributeTypeLabel(attr: YAMLMap): string | undefined {
  const typeNode = attr.get('type', true);
  if (typeof typeNode === 'string') return typeNode;
  if (isMap(typeNode) && (typeNode as YAMLMap).has('members')) return 'enum';
  const scalar = scalarNode(attr, 'type');
  return scalar && typeof scalar.value === 'string' ? scalar.value : undefined;
}

function extractEnumMembers(attr: YAMLMap, attrKey: string, ctx: Ctx): void {
  const typeNode = attr.get('type', true);
  if (!isMap(typeNode)) return;
  for (const member of mapItems(seq(typeNode as YAMLMap, 'members'))) {
    const idNode = scalarNode(member, 'id');
    if (!idNode || typeof idNode.value !== 'string') continue;
    ctx.defs.push({
      kind: 'enum_member',
      id: `${attrKey}.${idNode.value}`,
      uri: ctx.uri,
      nameRange: tokenRange(idNode, ctx.off),
      fullRange: member.range ? ctx.off.range(member.range[0], member.range[2]) : tokenRange(idNode, ctx.off),
      brief: readScalar(member, 'brief'),
      stability: readScalar(member, 'stability')
    });
  }
}

/** Signal arrays (attribute_groups, spans, events, metrics, entities). */
function extractSignalDefs(
  root: YAMLMap,
  array: string,
  idField: string,
  kind: DefKind,
  ctx: Ctx
): void {
  for (const item of mapItems(seq(root, array))) {
    const def = makeDef(item, idField, kind, ctx);
    if (def) {
      if (kind === 'metric') {
        def.instrument = readScalar(item, 'instrument');
        def.unit = readScalar(item, 'unit');
      }
      ctx.defs.push(def);
    }
    extractAttributeRefs(item, ctx);
    extractEntityAssociations(item, ctx);
  }
}

/** Refinement arrays: define a new id and reference the refined signal. */
function extractRefinements(
  root: YAMLMap,
  array: string,
  defKind: DefKind,
  refKind: RefKind,
  ctx: Ctx
): void {
  for (const item of mapItems(seq(root, array))) {
    const def = makeDef(item, 'id', defKind, ctx);
    if (def) ctx.defs.push(def);

    const refNode = scalarNode(item, 'ref');
    if (refNode && typeof refNode.value === 'string') {
      ctx.refs.push({
        refKind,
        id: refNode.value,
        uri: ctx.uri,
        range: tokenRange(refNode, ctx.off)
      });
    }
    extractAttributeRefs(item, ctx);
    extractEntityAssociations(item, ctx);
  }
}

/** An entity's `attributes:` list holds `ref` / `ref_group` references. */
function extractAttributeRefs(owner: YAMLMap, ctx: Ctx): void {
  for (const item of mapItems(seq(owner, 'attributes'))) {
    const ref = scalarNode(item, 'ref');
    if (ref && typeof ref.value === 'string') {
      ctx.refs.push({ refKind: 'attribute_ref', id: ref.value, uri: ctx.uri, range: tokenRange(ref, ctx.off) });
    }
    const refGroup = scalarNode(item, 'ref_group');
    if (refGroup && typeof refGroup.value === 'string') {
      ctx.refs.push({ refKind: 'group_ref', id: refGroup.value, uri: ctx.uri, range: tokenRange(refGroup, ctx.off) });
    }
  }
}

/** `entity_associations:` holds entity-type references (strings, or one_of/all_of). */
function extractEntityAssociations(owner: YAMLMap, ctx: Ctx): void {
  const assoc = seq(owner, 'entity_associations');
  if (!assoc) return;
  collectAssocStrings(assoc, ctx);
}

function collectAssocStrings(node: YAMLSeq, ctx: Ctx): void {
  for (const item of node.items) {
    if (item && typeof (item as Scalar).value === 'string' && (item as Scalar).range) {
      const s = item as Scalar;
      ctx.refs.push({
        refKind: 'entity_assoc',
        id: s.value as string,
        uri: ctx.uri,
        range: tokenRange(s, ctx.off)
      });
    } else if (isMap(item)) {
      for (const key of ['one_of', 'all_of']) {
        const nested = seq(item as YAMLMap, key);
        if (nested) collectAssocStrings(nested, ctx);
      }
    }
  }
}
