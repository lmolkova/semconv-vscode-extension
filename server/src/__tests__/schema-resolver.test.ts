import { describe, expect, it } from "vitest";

import type { PathStep } from "../key-path";
import { definitionResolver, manifestResolver } from "../schema-resolver";

const key = (name: string): PathStep => ({ kind: "key", name });
const item: PathStep = { kind: "item" };
const describeKeyPath = (steps: PathStep[]) => definitionResolver.describeKeyPath(steps);

describe("describeKeyPath (definition schema)", () => {
  it("resolves stability with its description and closed enum values", () => {
    const doc = describeKeyPath([key("attributes"), item, key("stability")]);
    expect(doc?.description).toBeTruthy();
    expect(doc?.enumValues).toEqual(
      expect.arrayContaining([
        "stable",
        "development",
        "deprecated",
        "alpha",
        "beta",
        "release_candidate",
      ]),
    );
  });

  it("resolves a plain string field (key) with no enum", () => {
    const doc = describeKeyPath([key("attributes"), item, key("key")]);
    expect(doc?.description).toBeTruthy();
    expect(doc?.enumValues).toBeUndefined();
  });

  it("resolves metric unit (description only) and instrument (enum)", () => {
    const unit = describeKeyPath([key("metrics"), item, key("unit")]);
    expect(unit?.description).toBeTruthy();
    expect(unit?.enumValues).toBeUndefined();

    const instrument = describeKeyPath([key("metrics"), item, key("instrument")]);
    expect(instrument?.enumValues).toEqual(
      expect.arrayContaining(["counter", "gauge", "histogram", "updowncounter"]),
    );
  });

  it("descends through a nested array + anyOf composition (enum member id)", () => {
    const doc = describeKeyPath([
      key("attributes"),
      item,
      key("type"),
      key("members"),
      item,
      key("id"),
    ]);
    expect(doc?.description).toBeTruthy();
  });

  it("unions oneOf branches for a group attribute ref", () => {
    const doc = describeKeyPath([
      key("attribute_groups"),
      item,
      key("attributes"),
      item,
      key("ref"),
    ]);
    expect(doc?.description).toBeTruthy();
  });

  it("resolves a signal's requirement_level (nullable nested const union)", () => {
    const doc = describeKeyPath([key("spans"), item, key("requirement_level")]);
    expect(doc?.enumValues).toEqual(expect.arrayContaining(["recommended", "opt_in"]));
  });

  it("resolves an attribute ref's requirement_level through nested unions", () => {
    const doc = describeKeyPath([
      key("spans"),
      item,
      key("attributes"),
      item,
      key("requirement_level"),
    ]);
    expect(doc?.enumValues).toEqual(expect.arrayContaining(["required", "recommended", "opt_in"]));
  });

  it("returns undefined for unknown keys and bogus root keys", () => {
    expect(describeKeyPath([key("attributes"), item, key("nonsense_key")])).toBeUndefined();
    expect(describeKeyPath([key("not_a_top_level")])).toBeUndefined();
  });
});

describe("describeKeyPath (manifest schema)", () => {
  const describe2 = (steps: PathStep[]) => manifestResolver.describeKeyPath(steps);

  it("documents the required schema_url key", () => {
    expect(describe2([key("schema_url")])?.description).toBeTruthy();
  });

  it("resolves stability to its closed enum via the Stability $ref", () => {
    const doc = describe2([key("stability")]);
    expect(doc?.description).toBeTruthy();
    expect(doc?.enumValues).toEqual(
      expect.arrayContaining([
        "stable",
        "development",
        "deprecated",
        "alpha",
        "beta",
        "release_candidate",
      ]),
    );
  });

  it("descends into a dependency's schema_url through the array", () => {
    expect(describe2([key("dependencies"), item, key("schema_url")])?.description).toBeTruthy();
  });

  it("does not leak definition-only keys into the manifest schema", () => {
    expect(describe2([key("attributes")])).toBeUndefined();
    expect(describe2([key("file_format")])).toBeUndefined();
  });
});
