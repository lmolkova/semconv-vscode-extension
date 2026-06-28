import { describe, expect, it } from "vitest";
import { Position, Range, TextEdit } from "vscode-languageserver";

import { RegistryIndex } from "../index";
import { extract } from "../model";
import { OffsetConverter } from "../parser";
import {
  buildRenameEdits,
  mentionEdits,
  mentionRanges,
  mentionsAt,
  prepareRename,
} from "../rename";
import { DefKind } from "../types";

const ATTRS = `file_format: definition/2
attributes:
  - key: gen_ai.request.model
    type: string
    stability: development
    brief: The model.
  - key: server.port
    type: int
    stability: stable
    brief: Server port.
`;

const SIGNALS = `file_format: definition/2
attribute_groups:
  - id: attributes.gen_ai.common
    visibility: internal
    attributes:
      - ref: gen_ai.request.model
        requirement_level: required
  - id: attributes.gen_ai.public
    visibility: public
    stability: development
    brief: Public group.
    attributes:
      - ref: gen_ai.request.model
        requirement_level: recommended
spans:
  - type: gen_ai.inference.client
    stability: development
    brief: A client call using \`gen_ai.request.model\`.
    name:
      note: Span name SHOULD be \`{gen_ai.request.model}\`.
    attributes:
      - ref_group: attributes.gen_ai.common
      - ref: gen_ai.request.model
        requirement_level: required
span_refinements:
  - id: openai.inference.client
    ref: gen_ai.inference.client
    stability: development
    brief: OpenAI refinement.
`;

const ATTRS_URI = "file:///attrs.yaml";
const SIGNALS_URI = "file:///signals.yaml";

function setup(): { index: RegistryIndex; texts: Map<string, string> } {
  const index = new RegistryIndex();
  const texts = new Map([
    [ATTRS_URI, ATTRS],
    [SIGNALS_URI, SIGNALS],
  ]);
  for (const [uri, text] of texts) {
    const { defs, refs, hasImports } = extract(text, uri);
    index.setDocument(uri, defs, refs, hasImports);
  }
  return { index, texts };
}

const getText = (texts: Map<string, string>) => (uri: string) => Promise.resolve(texts.get(uri));

function defPos(index: RegistryIndex, id: string, kind: DefKind): Position {
  const def = index.definitionsFor(id, [kind])[0];
  if (!def) throw new Error(`no def ${id}`);
  return def.nameRange.start;
}

function applyEdits(text: string, edits: TextEdit[]): string {
  const off = new OffsetConverter(text);
  const span = (r: Range): [number, number] => [off.offset(r.start), off.offset(r.end)];
  const sorted = [...edits].sort((a, b) => span(b.range)[0] - span(a.range)[0]);
  let out = text;
  for (const edit of sorted) {
    const [start, end] = span(edit.range);
    out = out.slice(0, start) + edit.newText + out.slice(end);
  }
  return out;
}

describe("rename – attribute", () => {
  it("renames in place, adds a deprecated stub, and updates refs across files", async () => {
    const { index, texts } = setup();
    const edit = await buildRenameEdits(
      index,
      ATTRS_URI,
      defPos(index, "gen_ai.request.model", "attribute"),
      "gen_ai.request.model_name",
      getText(texts),
    );
    expect(edit?.changes).toBeDefined();

    const attrs = applyEdits(ATTRS, edit!.changes![ATTRS_URI]);
    expect(attrs).toContain("  - key: gen_ai.request.model_name");
    expect(attrs).toContain("  - key: gen_ai.request.model\n");
    expect(attrs).toContain("    deprecated:");
    expect(attrs).toContain("      reason: renamed");
    expect(attrs).toContain("      renamed_to: gen_ai.request.model_name");
    expect(attrs).toContain('      note: "Renamed to `gen_ai.request.model_name`."');
    // The deprecated stub carries the old id; the live entry the new one.
    expect(attrs.match(/key: gen_ai\.request\.model_name/g)).toHaveLength(1);
    expect(attrs.match(/key: gen_ai\.request\.model$/gm)).toHaveLength(1);

    const signals = applyEdits(SIGNALS, edit!.changes![SIGNALS_URI]);
    expect(signals).not.toContain("ref: gen_ai.request.model\n");
    expect(signals.match(/ref: gen_ai\.request\.model_name/g)).toHaveLength(3);
    // Backtick- and brace-wrapped mentions in free-form brief/note follow the rename.
    expect(signals).toContain("brief: A client call using `gen_ai.request.model_name`.");
    expect(signals).toContain("note: Span name SHOULD be `{gen_ai.request.model_name}`.");
    expect(signals).not.toContain("gen_ai.request.model`");
  });

  it("can be triggered from a reference", async () => {
    const { index, texts } = setup();
    const refPos = index.referencesFor("gen_ai.request.model", "attribute")[0].range.start;
    const edit = await buildRenameEdits(index, SIGNALS_URI, refPos, "renamed.attr", getText(texts));
    const attrs = applyEdits(ATTRS, edit!.changes![ATTRS_URI]);
    expect(attrs).toContain("  - key: renamed.attr");
    expect(attrs).toContain("      renamed_to: renamed.attr");
  });
});

describe("rename – stub policy", () => {
  it("does not add a deprecated stub for attribute_groups", async () => {
    const { index, texts } = setup();
    const edit = await buildRenameEdits(
      index,
      SIGNALS_URI,
      defPos(index, "attributes.gen_ai.common", "attribute_group"),
      "attributes.gen_ai.shared",
      getText(texts),
    );
    const signals = applyEdits(SIGNALS, edit!.changes![SIGNALS_URI]);
    expect(signals).toContain("  - id: attributes.gen_ai.shared");
    expect(signals).not.toContain("attributes.gen_ai.common");
    expect(signals).not.toContain("deprecated:");
    expect(signals).toContain("ref_group: attributes.gen_ai.shared");
  });

  it("keeps a deprecated stub for refinements", async () => {
    const { index, texts } = setup();
    const edit = await buildRenameEdits(
      index,
      SIGNALS_URI,
      defPos(index, "openai.inference.client", "span_refinement"),
      "openai.inference.chat",
      getText(texts),
    );
    const signals = applyEdits(SIGNALS, edit!.changes![SIGNALS_URI]);
    expect(signals).toContain("  - id: openai.inference.chat");
    expect(signals).toContain("      renamed_to: openai.inference.chat");
    expect(signals).toContain("  - id: openai.inference.client");
  });

  it("keeps a deprecated stub for public attribute groups", async () => {
    const { index, texts } = setup();
    const edit = await buildRenameEdits(
      index,
      SIGNALS_URI,
      defPos(index, "attributes.gen_ai.public", "attribute_group"),
      "attributes.gen_ai.exported",
      getText(texts),
    );
    const signals = applyEdits(SIGNALS, edit!.changes![SIGNALS_URI]);
    expect(signals).toContain("  - id: attributes.gen_ai.exported");
    expect(signals).toContain("      renamed_to: attributes.gen_ai.exported");
    expect(signals).toContain("  - id: attributes.gen_ai.public");
  });
});

describe("mentionEdits", () => {
  const doc = `file_format: definition/2
attributes:
  - key: a.b
    brief: Uses \`a.b\` and {a.b}; ignores \`a.b.c\` and plain a.b.
    note: nested \`{a.b}\` template.
    examples: \`a.b\`
`;

  it("rewrites wrapped mentions only inside brief/note, leaving similar ids alone", () => {
    const out = applyEdits(doc, mentionEdits(doc, "a.b", "a.c"));
    expect(out).toContain("brief: Uses `a.c` and {a.c}; ignores `a.b.c` and plain a.b.");
    expect(out).toContain("note: nested `{a.c}` template.");
    // `examples` is not a free-form prose prop — left untouched.
    expect(out).toContain("examples: `a.b`");
  });
});

describe("mentionRanges", () => {
  const doc = `file_format: definition/2
attributes:
  - key: a.b
    brief: Uses \`a.b\` and {a.b}; ignores \`a.b.c\` and plain a.b.
    note: nested \`{a.b}\` template.
    examples: \`a.b\`
`;

  it("finds wrapped mentions only inside brief/note, each spanning the id", () => {
    const off = new OffsetConverter(doc);
    const got = mentionRanges(doc, "a.b").map((r) =>
      doc.slice(off.offset(r.start), off.offset(r.end)),
    );
    // Two in brief (backtick + brace), one in note; `a.b.c` and bare `a.b` excluded, examples skipped.
    expect(got).toEqual(["a.b", "a.b", "a.b"]);
  });

  it("returns nothing when the id is absent", () => {
    expect(mentionRanges(doc, "x.y")).toEqual([]);
  });
});

describe("mentionsAt", () => {
  const doc = `file_format: definition/2
attributes:
  - key: a.b
    brief: Uses \`a.b\` and {a.b.c}; plain a.b too.
    note: nested \`{a.b}\` template.
`;
  const off = new OffsetConverter(doc);
  // A position on the middle character of `token`'s first occurrence.
  const at = (token: string): Position =>
    off.position(doc.indexOf(token) + Math.floor(token.length / 2));

  it("resolves a backtick mention to the wrapped id", () => {
    expect(mentionsAt(doc, at("`a.b`")).map((m) => m.id)).toEqual(["a.b"]);
  });

  it("resolves a brace mention to the wrapped id", () => {
    expect(mentionsAt(doc, at("{a.b.c}")).map((m) => m.id)).toEqual(["a.b.c"]);
  });

  it("offers both candidates for a nested `{id}` so the caller can pick", () => {
    expect(mentionsAt(doc, at("{a.b}")).map((m) => m.id)).toEqual(["{a.b}", "a.b"]);
  });

  it("ignores unwrapped text and positions outside brief/note", () => {
    expect(mentionsAt(doc, at("plain a.b"))).toEqual([]);
    // The structural `key: a.b` is not a prose mention.
    expect(mentionsAt(doc, off.position(doc.indexOf("a.b"))).map((m) => m.id)).toEqual([]);
  });
});

describe("prepareRename", () => {
  it("accepts an attribute definition", () => {
    const { index } = setup();
    const result = prepareRename(index, ATTRS_URI, defPos(index, "server.port", "attribute"));
    expect(result?.placeholder).toBe("server.port");
  });

  it("rejects enum members and non-symbol positions", () => {
    const { index } = setup();
    expect(prepareRename(index, ATTRS_URI, Position.create(0, 0))).toBeNull();
  });
});
