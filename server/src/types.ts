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
// *_refinement_ref kinds -> a refinement's own ref. Resolution targets: RESOLUTION.
export type RefKind =
  | "attribute_ref"
  | "group_ref"
  | "entity_assoc"
  | "entity_refinement_ref"
  | "event_refinement_ref"
  | "metric_refinement_ref"
  | "span_refinement_ref";

export const RESOLUTION: Record<RefKind, DefKind[]> = {
  attribute_ref: ["attribute"],
  group_ref: ["attribute_group"],
  entity_assoc: ["entity"],
  entity_refinement_ref: ["entity"],
  event_refinement_ref: ["event"],
  metric_refinement_ref: ["metric"],
  span_refinement_ref: ["span"],
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
