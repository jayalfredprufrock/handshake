import { describe, expect, test } from "vite-plus/test";
import { Type } from "typebox";
import {
  normalizeIssues,
  parseBody,
  parseHeaders,
  parseParams,
  parseQuery,
  parseResponse,
  ResponseValidationError,
} from "./parse";

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

  test("honors an explicit additionalProperties: true instead of closing the object", () => {
    const schema = Type.Object({ name: Type.String() }, { additionalProperties: true });
    expect(parseBody(schema, { name: "a", extra: 1 })).toEqual({ name: "a", extra: 1 });
  });

  test("honors an explicit additionalProperties schema, validating the extra values", () => {
    const schema = Type.Object({ name: Type.String() }, { additionalProperties: Type.Number() });
    expect(parseBody(schema, { name: "a", count: 2 })).toEqual({ name: "a", count: 2 });
    expect(() => parseBody(schema, { name: "a", count: "nope" })).toThrow();
  });

  test("still enforces an explicit additionalProperties: false", () => {
    const schema = Type.Object({ name: Type.String() }, { additionalProperties: false });
    expect(() => parseBody(schema, { name: "a", extra: 1 })).toThrow();
  });

  test("closes nested objects and array items, not just the root", () => {
    const schema = Type.Object({
      n: Type.Object({ a: Type.String() }),
      items: Type.Array(Type.Object({ b: Type.String() })),
    });
    expect(() => parseBody(schema, { n: { a: "x", extra: 1 }, items: [] })).toThrow();
    expect(() => parseBody(schema, { n: { a: "x" }, items: [{ b: "y", extra: 1 }] })).toThrow();
    expect(parseBody(schema, { n: { a: "x" }, items: [{ b: "y" }] })).toEqual({
      n: { a: "x" },
      items: [{ b: "y" }],
    });
  });

  test("honors a nested additionalProperties opt-out", () => {
    const schema = Type.Object({
      n: Type.Object({ a: Type.String() }, { additionalProperties: true }),
    });
    expect(parseBody(schema, { n: { a: "x", extra: 1 } })).toEqual({ n: { a: "x", extra: 1 } });
  });

  test("leaves Type.Record open at any depth", () => {
    // Record uses patternProperties, not properties, so closing never touches it — this is
    // the supported way to model a dynamic payload.
    const schema = Type.Object({ meta: Type.Record(Type.String(), Type.Unknown()) });
    expect(parseBody(schema, { meta: { anything: 1, else: "two" } })).toEqual({
      meta: { anything: 1, else: "two" },
    });
  });

  test("honors additionalProperties per union variant", () => {
    const schema = Type.Union([
      Type.Object({ type: Type.Literal("OPEN"), x: Type.String() }, { additionalProperties: true }),
      Type.Object({ type: Type.Literal("CLOSED"), x: Type.String() }),
    ]);
    expect(parseBody(schema, { type: "OPEN", x: "1", extra: true })).toEqual({
      type: "OPEN",
      x: "1",
      extra: true,
    });
    expect(() => parseBody(schema, { type: "CLOSED", x: "1", extra: true })).toThrow();
  });
});

describe("parseQuery / parseParams / parseHeaders strictness", () => {
  test("rejects undeclared query parameters", () => {
    const schema = Type.Object({ page: Type.Number() });
    expect(parseQuery(schema, { page: ["2"] })).toEqual({ page: 2 });
    expect(() => parseQuery(schema, { page: ["2"], utm_source: ["ads"] })).toThrow();
  });

  test("still coerces query values after closing (schema keeps its TypeBox kind)", () => {
    // Regression: a spread-copied schema loses the non-enumerable `~kind` tag, which
    // silently disables Convert — coercion would return the raw strings instead.
    const schema = Type.Object({ page: Type.Number(), live: Type.Boolean() });
    expect(parseQuery(schema, { page: ["2"], live: ["true"] })).toEqual({ page: 2, live: true });
  });

  test("honors an additionalProperties opt-out on query", () => {
    const schema = Type.Object({ page: Type.Number() }, { additionalProperties: true });
    expect(parseQuery(schema, { page: ["2"], utm_source: ["ads"] })).toEqual({
      page: 2,
      utm_source: "ads",
    });
  });

  test("rejects undeclared path params but still coerces declared ones", () => {
    const schema = Type.Object({ id: Type.Number() });
    expect(parseParams(schema, { id: "42" })).toEqual({ id: 42 });
    expect(() => parseParams(schema, { id: "42", rogue: "x" })).toThrow();
  });

  test("leaves headers open — a real request carries many undeclared ones", () => {
    const schema = Type.Object({ "x-api-key": Type.String() });
    expect(
      parseHeaders(schema, { "x-api-key": "k", accept: "*/*", "user-agent": "curl" }),
    ).toMatchObject({ "x-api-key": "k" });
  });
});

describe("parseResponse strictness", () => {
  test("strips undeclared properties at every depth", () => {
    const schema = Type.Object({
      a: Type.String(),
      n: Type.Object({ b: Type.String() }),
      items: Type.Array(Type.Object({ c: Type.String() })),
    });
    expect(
      parseResponse(schema, {
        a: "x",
        secret: "LEAK",
        n: { b: "y", secret: "LEAK" },
        items: [{ c: "z", secret: "LEAK" }],
      }),
    ).toEqual({ a: "x", n: { b: "y" }, items: [{ c: "z" }] });
  });

  test("overrides a declared additionalProperties: true instead of leaking", () => {
    const schema = Type.Object({ a: Type.String() }, { additionalProperties: true });
    expect(parseResponse(schema, { a: "x", secret: "LEAK" })).toEqual({ a: "x" });
  });

  test("overrides a declared additionalProperties: true nested and in array items", () => {
    const schema = Type.Object({
      n: Type.Object({ b: Type.String() }, { additionalProperties: true }),
      items: Type.Array(Type.Object({ c: Type.String() }, { additionalProperties: true })),
    });
    expect(
      parseResponse(schema, { n: { b: "y", secret: "LEAK" }, items: [{ c: "z", secret: "LEAK" }] }),
    ).toEqual({ n: { b: "y" }, items: [{ c: "z" }] });
  });

  test("overrides a declared additionalProperties schema", () => {
    const schema = Type.Object({ a: Type.String() }, { additionalProperties: Type.Number() });
    expect(parseResponse(schema, { a: "x", n: 5 })).toEqual({ a: "x" });
  });

  test("overrides an opt-out inside a union variant", () => {
    const schema = Type.Union([
      Type.Object({ t: Type.Literal("A"), a: Type.String() }, { additionalProperties: true }),
    ]);
    expect(parseResponse(schema, { t: "A", a: "x", secret: "LEAK" })).toEqual({ t: "A", a: "x" });
  });

  test("keeps Type.Record payloads intact", () => {
    const schema = Type.Object({ meta: Type.Record(Type.String(), Type.Unknown()) });
    expect(parseResponse(schema, { meta: { anything: 1 } })).toEqual({ meta: { anything: 1 } });
  });

  test("still reports wrong types on declared properties as a server bug", () => {
    const schema = Type.Object({ a: Type.String() });
    expect(() => parseResponse(schema, { a: 123 })).toThrow(ResponseValidationError);
  });
});
