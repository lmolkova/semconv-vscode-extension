import { Position, Range, TextEdit, WorkspaceEdit } from "vscode-languageserver";
import { isScalar, visit } from "yaml";

import { RegistryIndex } from "./index";
import { OffsetConverter, parseSemconv } from "./parser";
import { Definition, DefKind, RESOLUTION } from "./types";

// Renaming a definition keeps the old id as a `deprecated: { reason: renamed,
// renamed_to }` stub — except internal attribute groups, which are private
// groupings with no telemetry history and are renamed in place (see `keepsStub`).
const RENAMABLE: ReadonlySet<DefKind> = new Set<DefKind>([
  "attribute",
  "attribute_group",
  "entity",
  "event",
  "metric",
  "span",
  "entity_refinement",
  "event_refinement",
  "metric_refinement",
  "span_refinement",
]);

// Public attribute groups carry telemetry meaning, so they keep a stub like
// signals; only `visibility: internal` groups are renamed in place.
function keepsStub(def: Definition): boolean {
  return !(def.kind === "attribute_group" && def.visibility === "internal");
}

export interface PrepareRename {
  range: Range;
  placeholder: string;
}

/** Reads a document's current source; open buffers win over on-disk content. */
export type TextProvider = (uri: string) => Promise<string | undefined>;

export function prepareRename(
  index: RegistryIndex,
  uri: string,
  position: Position,
): PrepareRename | null {
  const symbol = index.symbolAt(uri, position);
  if (!symbol) return null;
  if (symbol.kind === "definition") {
    return RENAMABLE.has(symbol.def.kind)
      ? { range: symbol.def.nameRange, placeholder: symbol.def.id }
      : null;
  }
  const defs = index.definitionsFor(symbol.ref.id, RESOLUTION[symbol.ref.refKind]);
  if (!defs.some((d) => RENAMABLE.has(d.kind))) return null;
  return { range: symbol.ref.range, placeholder: symbol.ref.id };
}

export async function buildRenameEdits(
  index: RegistryIndex,
  uri: string,
  position: Position,
  newName: string,
  getText: TextProvider,
): Promise<WorkspaceEdit | null> {
  const symbol = index.symbolAt(uri, position);
  if (!symbol) return null;

  const targets =
    symbol.kind === "definition"
      ? RENAMABLE.has(symbol.def.kind)
        ? [symbol.def]
        : []
      : index
          .definitionsFor(symbol.ref.id, RESOLUTION[symbol.ref.refKind])
          .filter((d) => RENAMABLE.has(d.kind));
  if (targets.length === 0) return null;

  const oldId = targets[0].id;
  const kind = targets[0].kind;
  if (!newName || newName === oldId) return null;

  const editsByUri = new Map<string, TextEdit[]>();
  const add = (u: string, edit: TextEdit): void => {
    const arr = editsByUri.get(u);
    if (arr) arr.push(edit);
    else editsByUri.set(u, [edit]);
  };

  for (const def of targets) {
    add(def.uri, TextEdit.replace(def.nameRange, newName));
    if (keepsStub(def)) {
      const text = await getText(def.uri);
      const stub = text && deprecatedStub(text, def, newName);
      if (stub) add(def.uri, stub);
    }
  }

  for (const ref of index.referencesFor(oldId, kind)) {
    add(ref.uri, TextEdit.replace(ref.range, newName));
  }

  for (const u of index.documentUris()) {
    const text = await getText(u);
    if (!text) continue;
    for (const edit of mentionEdits(text, oldId, newName)) add(u, edit);
  }

  const changes: Record<string, TextEdit[]> = {};
  for (const [u, edits] of editsByUri) changes[u] = edits;
  return { changes };
}

/**
 * A copy of the definition's entry (still carrying the old id) with a
 * `deprecated: renamed` block appended, inserted right after the renamed entry.
 */
function deprecatedStub(text: string, def: Definition, newName: string): TextEdit | undefined {
  const off = new OffsetConverter(text);
  const lineStart = off.offset(Position.create(def.fullRange.start.line, 0));
  let end = off.offset(def.fullRange.end);
  while (end > lineStart && /\s/.test(text[end - 1])) end--;
  const block = text.slice(lineStart, end);
  if (!block.trim()) return undefined;

  const indent = " ".repeat(def.fullRange.start.character);
  const deprecated =
    `${indent}deprecated:\n` +
    `${indent}  reason: renamed\n` +
    `${indent}  renamed_to: ${newName}\n` +
    `${indent}  note: ${JSON.stringify(`Renamed to \`${newName}\`.`)}`;

  return TextEdit.insert(off.position(end), `\n${block}\n${deprecated}`);
}

// Free-form prose props where an id is mentioned by name rather than referenced.
const FREE_FORM_KEYS: ReadonlySet<string> = new Set(["brief", "note"]);

// A mention is the id wrapped in backticks (`id`) or a template brace ({id}); the
// closing delimiter bounds the match, so `foo.bar` never matches inside `foo.bar.baz`.
const WRAPPERS: readonly [string, string][] = [
  ["`", "`"],
  ["{", "}"],
];

/** Rewrites backtick- or brace-wrapped mentions of `oldId` in `brief`/`note` text. */
export function mentionEdits(text: string, oldId: string, newId: string): TextEdit[] {
  // Wrapped mentions all contain the id verbatim, so skip the parse when it's absent.
  if (!text.includes(oldId)) return [];
  const { doc, offsets } = parseSemconv(text);
  const edits: TextEdit[] = [];
  visit(doc, {
    Pair(_, pair) {
      const key = isScalar(pair.key) ? pair.key.value : pair.key;
      if (typeof key !== "string" || !FREE_FORM_KEYS.has(key)) return;
      const value = pair.value;
      if (!isScalar(value) || typeof value.value !== "string" || !value.range) return;

      const from = value.range[0];
      const src = text.slice(from, value.range[1]);
      for (const [open, close] of WRAPPERS) {
        const needle = open + oldId + close;
        for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + needle.length)) {
          const idStart = from + i + open.length;
          edits.push(TextEdit.replace(offsets.range(idStart, idStart + oldId.length), newId));
        }
      }
    },
  });
  return edits;
}
