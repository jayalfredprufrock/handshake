import { describe, expect, test } from "vite-plus/test";
import * as T from "typebox";
import * as V from "typebox/value";
import { closeProperties } from "./close-properties";

describe("closeProperties", () => {
  const Schema = T.Object({ a: T.String(), nested: T.Object({ b: T.Number() }) });

  test("closed nodes keep their TypeBox kind", () => {
    const closed = closeProperties(Schema) as typeof Schema;
    expect(closed).not.toBe(Schema);
    expect(T.IsObject(closed)).toBe(true);
    expect(T.IsObject(closed.properties.nested)).toBe(true);
    expect((closed as { additionalProperties?: unknown }).additionalProperties).toBe(false);
  });

  test("Clean still strips through a closed node", () => {
    const closed = closeProperties(Schema, { mode: "force" });
    expect(V.Clean(closed, { a: "x", junk: 1, nested: { b: 1, junk: 2 } })).toEqual({
      a: "x",
      nested: { b: 1 },
    });
  });

  test("dropSharedIds sheds $id from a diverging node and keeps its kind", () => {
    const open = T.Object({ a: T.String() }, { $id: "Open", additionalProperties: true });
    const closed = closeProperties(open, { dropSharedIds: true });
    expect("$id" in closed).toBe(false);
    expect(T.IsObject(closed)).toBe(true);
  });

  test("returns the original reference when nothing changes", () => {
    const already = T.Object({ a: T.String() }, { additionalProperties: false });
    expect(closeProperties(already)).toBe(already);
  });
});
