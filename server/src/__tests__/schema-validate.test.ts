import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { parseSemconv } from "../parser";
import { schemaDiagnostics } from "../schema-validate";

const diags = (text: string) => schemaDiagnostics(parseSemconv(text));

describe("schemaDiagnostics", () => {
  it("returns nothing for a valid definition", () => {
    const text = `file_format: definition/2
attributes:
  - key: a.b
    type: string
    stability: development
    brief: An attribute.
`;
    expect(diags(text)).toEqual([]);
  });

  it("flags a span missing its required name", () => {
    const text = `file_format: definition/2
spans:
  - id: my.span
    kind: client
    stability: development
    brief: A span.
`;
    const found = diags(text);
    expect(found.some((f) => /Missing required field 'name'/.test(f.message))).toBe(true);
  });

  it("flags an unknown field", () => {
    const text = `file_format: definition/2
attributes:
  - key: a.b
    type: string
    stability: development
    brief: An attribute.
    bogus: nope
`;
    const found = diags(text);
    expect(found.some((f) => /Unknown field 'bogus'/.test(f.message))).toBe(true);
  });

  it("flags a bad enum value", () => {
    const text = `file_format: definition/2
attributes:
  - key: a.b
    type: string
    stability: nonsense
    brief: An attribute.
`;
    const found = diags(text);
    expect(found.some((f) => /Value must be one of/.test(f.message))).toBe(true);
  });

  it("returns nothing for a manifest (validated elsewhere)", () => {
    const text = `schema_url: https://opentelemetry.io/schemas/test/0.1.0
stability: development
`;
    expect(diags(text)).toEqual([]);
  });

  const registryDir = path.resolve(__dirname, "../../../test/fixtures/registry");
  for (const file of ["entities.yaml", "registry.yaml", "spans.yaml"]) {
    it(`reports no schema errors for the valid fixture ${file}`, () => {
      const text = fs.readFileSync(path.join(registryDir, file), "utf8");
      expect(diags(text)).toEqual([]);
    });
  }
});
