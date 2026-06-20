import { Range } from 'vscode-languageserver';

/**
 * Kinds of definable entities in a semconv `definition/2` document.
 * Each carries a unique id whose source field differs per kind:
 *   attribute        -> `key`
 *   attribute_group  -> `id`
 *   entity / span    -> `type`
 *   event / metric   -> `name`
 *   enum_member      -> `id` (inline under attribute `type.members`)
 *   *_refinement     -> `id` (the refinement's own id)
 */
export type DefKind =
  | 'attribute'
  | 'attribute_group'
  | 'entity'
  | 'event'
  | 'metric'
  | 'span'
  | 'enum_member'
  | 'entity_refinement'
  | 'event_refinement'
  | 'metric_refinement'
  | 'span_refinement';

/**
 * Kinds of cross-references between entities, and the DefKind(s) each resolves to.
 *   attribute_ref    (`ref`)            -> attribute
 *   group_ref        (`ref_group`)      -> attribute_group
 *   entity_assoc     (`entity_associations[]`) -> entity
 *   *_refinement_ref (`ref` on a refinement)   -> the matching signal
 */
export type RefKind =
  | 'attribute_ref'
  | 'group_ref'
  | 'entity_assoc'
  | 'entity_refinement_ref'
  | 'event_refinement_ref'
  | 'metric_refinement_ref'
  | 'span_refinement_ref';

/** Which definition kinds a given reference kind may resolve against. */
export const RESOLUTION: Record<RefKind, DefKind[]> = {
  attribute_ref: ['attribute'],
  group_ref: ['attribute_group'],
  entity_assoc: ['entity'],
  entity_refinement_ref: ['entity'],
  event_refinement_ref: ['event'],
  metric_refinement_ref: ['metric'],
  span_refinement_ref: ['span']
};

/** A defined entity, located in a specific document. */
export interface Definition {
  kind: DefKind;
  id: string;
  uri: string;
  /** Range of just the id token (where "go to definition" lands). */
  nameRange: Range;
  /** Range of the whole entity block (used for hover context / selection). */
  fullRange: Range;
  /** Optional human-readable fields surfaced on hover. */
  brief?: string;
  stability?: string;
  /** For attributes: the scalar type (e.g. `string`, `int`) or `enum`. */
  type?: string;
  /** For metrics. */
  instrument?: string;
  unit?: string;
}

/** A reference to some entity id, located in a specific document. */
export interface Reference {
  refKind: RefKind;
  id: string;
  uri: string;
  /** Range of the referenced id token (where the cursor must sit to navigate). */
  range: Range;
}

/** Result of locating the symbol under a cursor position. */
export type SymbolAt =
  | { kind: 'definition'; def: Definition }
  | { kind: 'reference'; ref: Reference };
