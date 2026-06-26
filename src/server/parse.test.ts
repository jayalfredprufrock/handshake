import { describe, expect, test } from "vite-plus/test";
import { normalizeIssues } from "./parse";

describe("normalizeIssues", () => {
  test("maps instancePath to a dot-notation path, keeps keyword, drops TypeBox internals", () => {
    const raw = [
      {
        keyword: "type",
        schemaPath: "#/properties/address/properties/street",
        instancePath: "/address/street",
        params: { type: "string" },
        message: "must be string",
      },
    ];
    expect(normalizeIssues(raw)).toEqual([
      { path: "address.street", keyword: "type", message: "must be string" },
    ]);
  });

  test("omits path for a root-level issue (empty instancePath)", () => {
    const raw = [
      { keyword: "required", instancePath: "", message: "must have required properties age" },
    ];
    expect(normalizeIssues(raw)).toEqual([
      { keyword: "required", message: "must have required properties age" },
    ]);
  });

  test("falls back to a generic message and tolerates non-arrays", () => {
    expect(normalizeIssues([{ instancePath: "/x" }])).toEqual([
      { path: "x", message: "Invalid value" },
    ]);
    expect(normalizeIssues(undefined)).toEqual([]);
  });
});
