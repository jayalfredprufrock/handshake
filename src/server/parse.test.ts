import { describe, expect, test } from "vite-plus/test";
import { Type } from "typebox";
import { normalizeIssues, parseBody } from "./parse";

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

  test("names each rejected field for an additionalProperties error", () => {
    const raw = [
      {
        keyword: "additionalProperties",
        schemaPath: "#",
        instancePath: "",
        params: { additionalProperties: ["extra", "another"] },
        message: "must not have additional properties",
      },
    ];
    expect(normalizeIssues(raw)).toEqual([
      {
        path: "extra",
        keyword: "additionalProperties",
        message: "must not have additional properties",
      },
      {
        path: "another",
        keyword: "additionalProperties",
        message: "must not have additional properties",
      },
    ]);
  });

  test("prefixes nested additionalProperties keys with the parent path", () => {
    const raw = [
      {
        keyword: "additionalProperties",
        instancePath: "/address",
        params: { additionalProperties: ["zip"] },
        message: "must not have additional properties",
      },
    ];
    expect(normalizeIssues(raw)).toEqual([
      {
        path: "address.zip",
        keyword: "additionalProperties",
        message: "must not have additional properties",
      },
    ]);
  });

  test("falls back to a single issue when additionalProperties params are absent", () => {
    const raw = [
      {
        keyword: "additionalProperties",
        instancePath: "",
        message: "must not have additional properties",
      },
    ];
    expect(normalizeIssues(raw)).toEqual([
      { keyword: "additionalProperties", message: "must not have additional properties" },
    ]);
  });

  test("falls back to a generic message and tolerates non-arrays", () => {
    expect(normalizeIssues([{ instancePath: "/x" }])).toEqual([
      { path: "x", message: "Invalid value" },
    ]);
    expect(normalizeIssues(undefined)).toEqual([]);
  });
});

describe("parseBody", () => {
  test("rejects extra properties on object bodies", () => {
    const schema = Type.Object({ name: Type.String() });
    expect(() => parseBody(schema, { name: "a", extra: 1 })).toThrow();
    expect(parseBody(schema, { name: "a" })).toEqual({ name: "a" });
  });

  test("accepts valid union bodies (closedness applies per-variant, not at the anyOf root)", () => {
    const schema = Type.Union([
      Type.Object({ type: Type.Literal("VIRTUAL"), studyId: Type.String() }),
      Type.Object({
        type: Type.Literal("IN_PERSON"),
        studyId: Type.String(),
        location: Type.Optional(Type.String()),
      }),
    ]);
    expect(parseBody(schema, { type: "VIRTUAL", studyId: "ST1" })).toEqual({
      type: "VIRTUAL",
      studyId: "ST1",
    });
    expect(parseBody(schema, { type: "IN_PERSON", studyId: "ST1", location: "HQ" })).toEqual({
      type: "IN_PERSON",
      studyId: "ST1",
      location: "HQ",
    });
  });

  test("rejects extra properties inside union variants", () => {
    const schema = Type.Union([Type.Object({ type: Type.Literal("A"), x: Type.String() })]);
    expect(() => parseBody(schema, { type: "A", x: "1", junk: true })).toThrow();
  });

  test("leaves non-object roots untouched", () => {
    expect(parseBody(Type.String(), "hello")).toBe("hello");
    expect(parseBody(Type.Array(Type.Object({ id: Type.String() })), [{ id: "1" }])).toEqual([
      { id: "1" },
    ]);
  });
});
