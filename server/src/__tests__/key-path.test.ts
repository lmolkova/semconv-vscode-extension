import { describe, expect, it } from "vitest";

import { pathAt, PathStep } from "../key-path";
import { definitionResolver } from "../schema-resolver";

const DOC = `file_format: definition/2
attributes:
  - key: gen_ai.provider.name
    type:
      members:
        - id: openai
          stability: development
    stability: development
    brief: hello
`;

const MANIFEST = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
description: A manifest.
stability: development
`;

/** Position (line/character) of the start of the `nth` (0-based) occurrence of `needle`. */
function posOf(text: string, needle: string, nth = 0) {
  let idx = -1;
  for (let i = 0; i <= nth; i++) idx = text.indexOf(needle, idx + 1);
  const before = text.slice(0, idx);
  return { line: before.split("\n").length - 1, character: idx - (before.lastIndexOf("\n") + 1) };
}

const k = (name: string): PathStep => ({ kind: "key", name });
const item: PathStep = { kind: "item" };

describe("pathAt", () => {
  it("returns the schema path for an attribute-level key", () => {
    const hit = pathAt(DOC, posOf(DOC, "stability", 1)); // [0] is the member's stability
    expect(hit?.kind).toBe("definition");
    expect(hit?.onValue).toBe(false);
    expect(hit?.steps).toEqual([k("attributes"), item, k("stability")]);
  });

  it("returns the path for a key inside an array item", () => {
    const hit = pathAt(DOC, posOf(DOC, "key:"));
    expect(hit?.steps).toEqual([k("attributes"), item, k("key")]);
    expect(hit?.onValue).toBe(false);
  });

  it("descends through a nested array (enum member id)", () => {
    const hit = pathAt(DOC, posOf(DOC, "id:"));
    expect(hit?.steps).toEqual([k("attributes"), item, k("type"), k("members"), item, k("id")]);
  });

  it("flags a hit on a value scalar with onValue + value", () => {
    const hit = pathAt(DOC, posOf(DOC, "development", 1));
    expect(hit?.onValue).toBe(true);
    expect(hit?.value).toBe("development");
    expect(hit?.key).toBe("stability");
  });

  it("reports a hit on an id value too (the server defers these to symbolAt)", () => {
    const hit = pathAt(DOC, posOf(DOC, "gen_ai.provider.name"));
    expect(hit?.onValue).toBe(true);
    expect(hit?.key).toBe("key");
  });

  it("returns undefined for yaml that is neither a definition nor a manifest", () => {
    expect(pathAt("foo: bar\n", { line: 0, character: 0 })).toBeUndefined();
  });

  it("tags manifest hits with the manifest kind", () => {
    const hit = pathAt(MANIFEST, posOf(MANIFEST, "schema_url"));
    expect(hit?.kind).toBe("manifest");
    expect(hit?.steps).toEqual([k("schema_url")]);
  });

  it("flags a manifest enum value on its value scalar", () => {
    const hit = pathAt(MANIFEST, posOf(MANIFEST, "development"));
    expect(hit?.kind).toBe("manifest");
    expect(hit?.onValue).toBe(true);
    expect(hit?.value).toBe("development");
    expect(hit?.key).toBe("stability");
  });

  it("composes with the matching resolver to document a hovered key", () => {
    const hit = pathAt(DOC, posOf(DOC, "stability", 1))!;
    const doc = definitionResolver.describeKeyPath(hit.steps);
    expect(doc?.description).toBeTruthy();
    expect(doc?.enumValues).toEqual(expect.arrayContaining(["stable", "development"]));
  });
});
