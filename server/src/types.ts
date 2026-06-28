import { Range } from "vscode-languageserver";

// Each kind's id comes from a different YAML field: attribute -> key;
// entity, span -> type; event, metric -> name; everything else -> id.
export type DefKind =
  | "attribute"
  | "attribute_group"
  | "entity"
  | "event"
  | "metric"
  | "span"
  | "enum_member"
  | "entity_refinement"
  | "event_refinement"
  | "metric_refinement"
  | "span_refinement";

// The YAML field each reference comes from: attribute_ref -> ref;
// group_ref -> ref_group; entity_assoc -> entity_associations[]; the
// *_refinement_ref kinds -> a refinement's own ref. The md_* kinds come from
// `<!-- weaver ... -->` snippet queries in markdown. Resolution targets: RESOLUTION.
export type RefKind =
  | "attribute_ref"
  | "group_ref"
  | "entity_assoc"
  | "entity_refinement_ref"
  | "event_refinement_ref"
  | "metric_refinement_ref"
  | "span_refinement_ref"
  | "md_attribute_ref"
  | "md_event_ref"
  | "md_metric_ref"
  | "md_span_ref"
  | "md_entity_ref"
  | "md_event_refinement_ref"
  | "md_metric_refinement_ref"
  | "md_span_refinement_ref"
  | "md_entity_refinement_ref";

export const RESOLUTION: Record<RefKind, DefKind[]> = {
  attribute_ref: ["attribute"],
  group_ref: ["attribute_group"],
  entity_assoc: ["entity"],
  entity_refinement_ref: ["entity"],
  event_refinement_ref: ["event"],
  metric_refinement_ref: ["metric"],
  span_refinement_ref: ["span"],
  md_attribute_ref: ["attribute"],
  md_event_ref: ["event"],
  md_metric_ref: ["metric"],
  md_span_ref: ["span"],
  md_entity_ref: ["entity"],
  md_event_refinement_ref: ["event_refinement"],
  md_metric_refinement_ref: ["metric_refinement"],
  md_span_refinement_ref: ["span_refinement"],
  md_entity_refinement_ref: ["entity_refinement"],
};

export interface Definition {
  kind: DefKind;
  id: string;
  uri: string;
  nameRange: Range;
  fullRange: Range;
  brief?: string;
  stability?: string;
  type?: string;
  instrument?: string;
  unit?: string;
  visibility?: string;
}

export interface Reference {
  refKind: RefKind;
  id: string;
  uri: string;
  range: Range;
}

export type SymbolAt =
  | { kind: "definition"; def: Definition }
  | { kind: "reference"; ref: Reference };
