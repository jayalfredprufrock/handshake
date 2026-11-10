import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import { DiscriminatedUnion, IsDiscriminatedUnion } from "./discriminated-union";
import type { TDiscriminatedUnion } from "./discriminated-union";

const Cat = T.Object({ kind: T.Literal("cat"), meow: T.Boolean() });
const Dog = T.Object({ kind: T.Literal("dog"), bark: T.Number() });

describe("DiscriminatedUnion", () => {
  test("builds a plain union annotated with the discriminator", () => {
    const Pet = DiscriminatedUnion("kind", [Cat, Dog], { description: "pet" });
    expect(T.IsUnion(Pet)).toBe(true);
    expect(Pet.anyOf).toEqual([Cat, Dog]);
    expect(Pet.discriminator).toEqual({ propertyName: "kind" });
    expect(Pet).toMatchObject({ description: "pet" });
    expectTypeOf(Pet).toExtend<TDiscriminatedUnion<"kind">>();
    expectTypeOf<Static<typeof Pet>>().toEqualTypeOf<
      { kind: "cat"; meow: boolean } | { kind: "dog"; bark: number }
    >();
  });

  test("rejects a discriminator that isn't a literal in every variant", () => {
    const NoTag = T.Object({ bark: T.Number() });
    const StringTag = T.Object({ kind: T.String() });
    // @ts-expect-error typo
    DiscriminatedUnion("knd", [Cat, Dog]);
    // @ts-expect-error shared field, but not a literal
    DiscriminatedUnion("meow", [Cat, Cat]);
    // @ts-expect-error one variant lacks the tag
    DiscriminatedUnion("kind", [Cat, NoTag]);
    // @ts-expect-error tag isn't a literal in one variant
    DiscriminatedUnion("kind", [Cat, StringTag]);
  });
});

describe("IsDiscriminatedUnion", () => {
  test("detects the annotation, whether built by the helper or by hand", () => {
    expect(IsDiscriminatedUnion(DiscriminatedUnion("kind", [Cat, Dog]))).toBe(true);
    expect(
      IsDiscriminatedUnion(T.Union([Cat, Dog], { discriminator: { propertyName: "kind" } })),
    ).toBe(true);
    expect(IsDiscriminatedUnion(T.Union([Cat, Dog]))).toBe(false);
    expect(IsDiscriminatedUnion(Cat)).toBe(false);
  });
});
