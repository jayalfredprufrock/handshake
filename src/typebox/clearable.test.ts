import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import * as V from "typebox/value";
import { DeepOmit, DeepPick } from "./deep-pick-omit";
import { AdmitsNull, Clearable, IsClearable, type StaticClearable } from "./clearable";

const Org = T.Object({
  name: T.String(),
  logoUrl: Clearable(T.String()),
  note: T.Optional(T.String()),
});

describe("Clearable", () => {
  test("is optional, marked, and still the wrapped kind", () => {
    const logoUrl = Org.properties.logoUrl;
    expect(T.IsOptional(logoUrl)).toBe(true);
    expect(logoUrl["x-clearable"]).toBe(true);
    expect(T.IsString(logoUrl)).toBe(true);
  });

  test("validation ignores the keyword: null is still rejected, undefined accepted", () => {
    expect(V.Check(Org, { name: "a", logoUrl: null })).toBe(false);
    expect(V.Check(Org, { name: "a", logoUrl: undefined })).toBe(true);
  });

  test("survives Partial, Pick, Omit, Interface, DeepPick and DeepOmit", () => {
    expect(IsClearable(T.Partial(Org).properties.logoUrl)).toBe(true);
    expect(IsClearable(T.Pick(Org, ["logoUrl"]).properties.logoUrl)).toBe(true);
    expect(IsClearable(T.Omit(Org, ["name"]).properties.logoUrl)).toBe(true);
    expect(IsClearable(T.Interface([Org], {}).properties.logoUrl)).toBe(true);
    expect(IsClearable(DeepPick(Org, ["logoUrl"]).properties.logoUrl)).toBe(true);
    expect(IsClearable(DeepOmit(Org, ["name"]).properties.logoUrl)).toBe(true);
  });

  test("Static is the plain optional type", () => {
    expectTypeOf<Static<typeof Org>>().toEqualTypeOf<{
      name: string;
      logoUrl?: string;
      note?: string;
    }>();
  });
});

describe("IsClearable", () => {
  test("requires both the keyword and optional", () => {
    expect(IsClearable(Org.properties.logoUrl)).toBe(true);
    expect(IsClearable(Org.properties.note)).toBe(false);
    expect(IsClearable(T.Required(Org).properties.logoUrl)).toBe(false);
  });
});

describe("AdmitsNull", () => {
  test("detects schemas that accept null on their own", () => {
    expect(AdmitsNull(T.Null())).toBe(true);
    expect(AdmitsNull(T.Unknown())).toBe(true);
    expect(AdmitsNull(T.Any())).toBe(true);
    expect(AdmitsNull(T.Union([T.String(), T.Null()]))).toBe(true);
    expect(AdmitsNull(T.String())).toBe(false);
  });
});

describe("StaticClearable", () => {
  test("widens clearable properties to accept null, keeping optionality", () => {
    expectTypeOf<StaticClearable<typeof Org>>().toEqualTypeOf<{
      name: string;
      logoUrl?: string | null;
      note?: string;
    }>();
  });

  test("survives Partial", () => {
    const Patch = T.Partial(Org);
    expectTypeOf<StaticClearable<typeof Patch>>().toEqualTypeOf<{
      name?: string;
      logoUrl?: string | null;
      note?: string;
    }>();
  });

  test("is plain Static when nothing is clearable", () => {
    const Plain = T.Object({ a: T.Optional(T.String()) });
    expectTypeOf<StaticClearable<typeof Plain>>().toEqualTypeOf<{ a?: string }>();
  });
});
