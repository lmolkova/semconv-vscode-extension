import { describe, expect, it } from "vitest";

import { manifestDiagnostics } from "../manifest";
import { parseSemconv } from "../parser";

const diags = (text: string) => manifestDiagnostics(parseSemconv(text));

describe("manifestDiagnostics", () => {
  it("returns nothing for a valid manifest", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
stability: development
dependencies:
  - schema_url: https://opentelemetry.io/schemas/other/1.0.0
`;
    expect(diags(text)).toEqual([]);
  });

  it("returns nothing when there are no dependencies", () => {
    expect(diags("schema_url: https://opentelemetry.io/schemas/test/0.1.0\n")).toEqual([]);
  });

  it("flags a dependency missing its required schema_url", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
dependencies:
  - registry_path: ./local/registry
`;
    const found = diags(text);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/missing the required 'schema_url'/);
  });

  it("flags a duplicate dependency schema_url", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
dependencies:
  - schema_url: https://opentelemetry.io/schemas/dup/1.0.0
  - schema_url: https://opentelemetry.io/schemas/dup/1.0.0
`;
    const found = diags(text);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/Duplicate dependency/);
  });

  it("flags a non-mapping dependency entry", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
dependencies:
  - just-a-string
`;
    const found = diags(text);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/must be a mapping/);
  });

  it("flags a non-list dependencies value", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
dependencies:
  schema_url: https://opentelemetry.io/schemas/other/1.0.0
`;
    const found = diags(text);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/must be a list/);
  });

  it("flags an unknown top-level field", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
dependencies-typo:
  - schema_url: https://opentelemetry.io/schemas/other/1.0.0
`;
    const found = diags(text);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/Unknown field 'dependencies-typo'/);
  });

  it("flags an unknown field on a dependency", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
dependencies:
  - schema_url: https://opentelemetry.io/schemas/other/1.0.0
    bogus: nope
`;
    const found = diags(text);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/Unknown field 'bogus'/);
  });

  it("flags a malformed top-level schema_url", () => {
    const found = diags("schema_url: https://opentelemetry.io/registry/test\n");
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/Schema URL must follow/);
  });

  it("flags a dependency schema_url missing a version", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
dependencies:
  - schema_url: https://opentelemetry.io/schemas/other
`;
    const found = diags(text);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/Schema URL must follow/);
  });

  it("accepts a schema_url with a prerelease suffix", () => {
    const found = diags("schema_url: https://opentelemetry.io/schemas/test/1.2.3-rc.1\n");
    expect(found).toEqual([]);
  });

  it("accepts a schema_url with an arbitrary path", () => {
    const found = diags("schema_url: https://example.com/any/nested/path/2.0.0\n");
    expect(found).toEqual([]);
  });

  it("flags an invalid stability value", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
stability: nonsense
`;
    const found = diags(text);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/Value must be one of/);
  });

  it("returns nothing for a definition file", () => {
    const text = `file_format: definition/2
attributes:
  - key: a.b
    type: string
    stability: development
`;
    expect(diags(text)).toEqual([]);
  });

  it("does not treat a file with an unknown file_format as a manifest", () => {
    const text = `file_format: definition/99
schema_url: https://opentelemetry.io/schemas/test/0.1.0
dependencies:
  - just-a-string
`;
    expect(diags(text)).toEqual([]);
  });
});
