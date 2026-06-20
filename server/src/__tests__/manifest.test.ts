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

  it("returns nothing for a definition file", () => {
    const text = `file_format: definition/2
attributes:
  - key: a.b
    type: string
    stability: development
`;
    expect(diags(text)).toEqual([]);
  });
});
