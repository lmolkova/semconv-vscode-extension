import { isMap, isScalar, Scalar, visit, YAMLMap, YAMLSeq } from "yaml";

import { FREE_FORM_KEYS, wrappedMentions } from "./mentions";
import {
  mapItems,
  OffsetConverter,
  ParsedSemconv,
  parseSemconv,
  readScalar,
  scalarNode,
  seq,
  tokenRange,
} from "./parser";
import { Definition, DefKind, Reference, RefKind } from "./types";

export interface ExtractResult {
  isSemconv: boolean;
  defs: Definition[];
  refs: Reference[];
  // Backtick-/brace-wrapped id mentions in `brief`/`note` prose. Kept apart from
  // `refs` because they resolve against every definition kind and render inline with
  // the surrounding prose; an unresolved one is reported like any other ref.
  proseRefs: Reference[];
  hasImports: boolean;
}

const SIGNAL_DEFS: { array: string; idField: string; kind: DefKind }[] = [
  { array: "attribute_groups", idField: "id", kind: "attribute_group" },
  { array: "entities", idField: "type", kind: "entity" },
  { array: "events", idField: "name", kind: "event" },
  { array: "metrics", idField: "name", kind: "metric" },
  { array: "spans", idField: "type", kind: "span" },
];

const REFINEMENTS: { array: string; defKind: DefKind; refKind: RefKind }[] = [
  { array: "entity_refinements", defKind: "entity_refinement", refKind: "entity_refinement_ref" },
  { array: "event_refinements", defKind: "event_refinement", refKind: "event_refinement_ref" },
  { array: "metric_refinements", defKind: "metric_refinement", refKind: "metric_refinement_ref" },
  { array: "span_refinements", defKind: "span_refinement", refKind: "span_refinement_ref" },
];

/** `parsed` lets callers reuse a version-cached parse instead of re-parsing `text`. */
export function extract(
  text: string,
  uri: string,
  parsed: ParsedSemconv = parseSemconv(text),
): ExtractResult {
  const defs: Definition[] = [];
  const refs: Reference[] = [];

  if (parsed.kind !== "definition" || !parsed.root) {
    return { isSemconv: false, defs, refs, proseRefs: [], hasImports: false };
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

  const proseRefs = extractProseMentions(parsed.doc, text, uri, off);
  return { isSemconv: true, defs, refs, proseRefs, hasImports: root.has("imports") };
}

function extractProseMentions(
  doc: ReturnType<typeof parseSemconv>["doc"],
  text: string,
  uri: string,
  off: OffsetConverter,
): Reference[] {
  const proseRefs: Reference[] = [];
  visit(doc, {
    Pair(_, pair) {
      const key = isScalar(pair.key) ? pair.key.value : pair.key;
      if (typeof key !== "string" || !FREE_FORM_KEYS.has(key)) return;
      const value = pair.value;
      if (!isScalar(value) || typeof value.value !== "string" || !value.range) return;
      const from = value.range[0];
      for (const m of wrappedMentions(text.slice(from, value.range[1]))) {
        // A real id is a single token; skip spans that wrap whitespace or another
        // delimiter (e.g. a backtick around `{a} {b}`), which only resolve by accident
        // and would otherwise be flagged unresolved.
        if (!MENTION_ID.test(m.id)) continue;
        proseRefs.push({
          refKind: "prose_ref",
          id: m.id,
          uri,
          range: off.range(from + m.start, from + m.end),
        });
      }
    },
  });
  return proseRefs;
}

const MENTION_ID = /^[^\s`{}]+$/;

interface Ctx {
  off: OffsetConverter;
  uri: string;
  defs: Definition[];
  refs: Reference[];
}

function makeDef(map: YAMLMap, idField: string, kind: DefKind, ctx: Ctx): Definition | undefined {
  const idNode = scalarNode(map, idField);
  if (!idNode || typeof idNode.value !== "string") return undefined;
  const full = map.range ? ctx.off.range(map.range[0], map.range[2]) : tokenRange(idNode, ctx.off);
  return {
    kind,
    id: idNode.value,
    uri: ctx.uri,
    nameRange: tokenRange(idNode, ctx.off),
    fullRange: full,
    brief: readScalar(map, "brief"),
    stability: readScalar(map, "stability"),
  };
}

function extractAttributeDefs(root: YAMLMap, ctx: Ctx): void {
  for (const item of mapItems(seq(root, "attributes"))) {
    const def = makeDef(item, "key", "attribute", ctx);
    if (!def) continue;
    def.type = attributeTypeLabel(item);
    ctx.defs.push(def);
    extractEnumMembers(item, def.id, ctx);
  }
}

function attributeTypeLabel(attr: YAMLMap): string | undefined {
  const typeNode = attr.get("type", true);
  if (typeof typeNode === "string") return typeNode;
  if (isMap(typeNode) && (typeNode as YAMLMap).has("members")) return "enum";
  const scalar = scalarNode(attr, "type");
  return scalar && typeof scalar.value === "string" ? scalar.value : undefined;
}

function extractEnumMembers(attr: YAMLMap, attrKey: string, ctx: Ctx): void {
  const typeNode = attr.get("type", true);
  if (!isMap(typeNode)) return;
  for (const member of mapItems(seq(typeNode, "members"))) {
    const idNode = scalarNode(member, "id");
    if (!idNode || typeof idNode.value !== "string") continue;
    ctx.defs.push({
      kind: "enum_member",
      id: `${attrKey}.${idNode.value}`,
      uri: ctx.uri,
      nameRange: tokenRange(idNode, ctx.off),
      fullRange: member.range
        ? ctx.off.range(member.range[0], member.range[2])
        : tokenRange(idNode, ctx.off),
      brief: readScalar(member, "brief"),
      stability: readScalar(member, "stability"),
    });
  }
}

function extractSignalDefs(
  root: YAMLMap,
  array: string,
  idField: string,
  kind: DefKind,
  ctx: Ctx,
): void {
  for (const item of mapItems(seq(root, array))) {
    const def = makeDef(item, idField, kind, ctx);
    if (def) {
      if (kind === "metric") {
        def.instrument = readScalar(item, "instrument");
        def.unit = readScalar(item, "unit");
      }
      if (kind === "attribute_group") {
        def.visibility = readScalar(item, "visibility");
      }
      ctx.defs.push(def);
    }
    extractAttributeRefs(item, ctx);
    extractEntityAssociations(item, ctx);
  }
}

function extractRefinements(
  root: YAMLMap,
  array: string,
  defKind: DefKind,
  refKind: RefKind,
  ctx: Ctx,
): void {
  for (const item of mapItems(seq(root, array))) {
    const def = makeDef(item, "id", defKind, ctx);
    if (def) ctx.defs.push(def);

    const refNode = scalarNode(item, "ref");
    if (refNode && typeof refNode.value === "string") {
      ctx.refs.push({
        refKind,
        id: refNode.value,
        uri: ctx.uri,
        range: tokenRange(refNode, ctx.off),
      });
    }
    extractAttributeRefs(item, ctx);
    extractEntityAssociations(item, ctx);
  }
}

// `attributes` carries refs on groups/spans/metrics/events; entities instead
// list their refs under `identity` and `description`.
const ATTRIBUTE_REF_FIELDS = ["attributes", "identity", "description"];

function extractAttributeRefs(owner: YAMLMap, ctx: Ctx): void {
  for (const field of ATTRIBUTE_REF_FIELDS) {
    for (const item of mapItems(seq(owner, field))) {
      const ref = scalarNode(item, "ref");
      if (ref && typeof ref.value === "string") {
        ctx.refs.push({
          refKind: "attribute_ref",
          id: ref.value,
          uri: ctx.uri,
          range: tokenRange(ref, ctx.off),
        });
      }
      const refGroup = scalarNode(item, "ref_group");
      if (refGroup && typeof refGroup.value === "string") {
        ctx.refs.push({
          refKind: "group_ref",
          id: refGroup.value,
          uri: ctx.uri,
          range: tokenRange(refGroup, ctx.off),
        });
      }
    }
  }
}

function extractEntityAssociations(owner: YAMLMap, ctx: Ctx): void {
  const assoc = seq(owner, "entity_associations");
  if (!assoc) return;
  collectAssocStrings(assoc, ctx);
}

function collectAssocStrings(node: YAMLSeq, ctx: Ctx): void {
  for (const item of node.items) {
    if (item && typeof (item as Scalar).value === "string" && (item as Scalar).range) {
      const s = item as Scalar;
      ctx.refs.push({
        refKind: "entity_assoc",
        id: s.value as string,
        uri: ctx.uri,
        range: tokenRange(s, ctx.off),
      });
    } else if (isMap(item)) {
      for (const key of ["one_of", "all_of"]) {
        const nested = seq(item, key);
        if (nested) collectAssocStrings(nested, ctx);
      }
    }
  }
}
