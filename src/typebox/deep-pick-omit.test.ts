import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import * as Value from "typebox/value";
import { DeepOmit, DeepPick } from "./deep-pick-omit";
import type { DeepKeyOf } from "./deep-pick-omit";

const Address = T.Object({
  street: T.String(),
  city: T.String(),
  zip: T.String(),
});

const User = T.Object({
  id: T.String(),
  name: T.String(),
  address: Address,
});

describe("DeepPick", () => {
  test("picks top-level keys", () => {
    const picked = DeepPick(User, ["id", "name"]);

    expect(Object.keys(picked.properties).sort()).toEqual(["id", "name"]);
    expectTypeOf<Static<typeof picked>>().toEqualTypeOf<{ id: string; name: string }>();
  });

  test("picks an entire nested object by key", () => {
    const picked = DeepPick(User, ["id", "address"]);

    expect(Object.keys(picked.properties).sort()).toEqual(["address", "id"]);
    expectTypeOf<Static<typeof picked>>().toEqualTypeOf<{
      id: string;
      address: { street: string; city: string; zip: string };
    }>();
  });

  test("picks nested properties via dot notation", () => {
    const picked = DeepPick(User, ["id", "address.street"]);

    expect(Object.keys(picked.properties).sort()).toEqual(["address", "id"]);
    expect(Object.keys(picked.properties.address.properties)).toEqual(["street"]);
    expectTypeOf<Static<typeof picked>>().toEqualTypeOf<{
      id: string;
      address: { street: string };
    }>();
  });
});

describe("DeepOmit", () => {
  test("omits top-level keys", () => {
    const omitted = DeepOmit(User, ["address"]);

    expect(Object.keys(omitted.properties).sort()).toEqual(["id", "name"]);
    expectTypeOf<Static<typeof omitted>>().toEqualTypeOf<{ id: string; name: string }>();
  });

  test("omits nested properties via dot notation", () => {
    const omitted = DeepOmit(User, ["address.zip"]);

    expect(Object.keys(omitted.properties.address.properties).sort()).toEqual(["city", "street"]);
    expectTypeOf<Static<typeof omitted>>().toEqualTypeOf<{
      id: string;
      name: string;
      address: { street: string; city: string };
    }>();
  });
});

describe("unions of objects", () => {
  const Shape = T.Union([
    T.Object({ kind: T.Literal("circle"), radius: T.Number() }),
    T.Object({ kind: T.Literal("square"), size: T.Number() }),
  ]);

  test("picks keys that exist on only some union members", () => {
    const picked = DeepPick(Shape, ["kind", "radius"]);

    expect(picked.anyOf).toHaveLength(2);
    expectTypeOf<Static<typeof picked>>().toEqualTypeOf<
      { kind: "circle"; radius: number } | { kind: "square" }
    >();
  });

  test("omits keys across union members", () => {
    const omitted = DeepOmit(Shape, ["kind"]);

    expectTypeOf<Static<typeof omitted>>().toEqualTypeOf<{ radius: number } | { size: number }>();
  });

  test("supports a nested union object", () => {
    const Account = T.Object({
      id: T.String(),
      owner: T.Union([
        T.Object({ type: T.Literal("person"), firstName: T.String(), lastName: T.String() }),
        T.Object({ type: T.Literal("org"), orgName: T.String() }),
      ]),
    });

    const picked = DeepPick(Account, ["id", "owner.type", "owner.firstName"]);

    expectTypeOf<Static<typeof picked>>().toEqualTypeOf<{
      id: string;
      owner: { type: "person"; firstName: string } | { type: "org" };
    }>();
  });
});

describe("strongly typed keys", () => {
  test("valid key paths are accepted", () => {
    expectTypeOf<DeepKeyOf<typeof User>>().toEqualTypeOf<
      "id" | "name" | "address" | "address.street" | "address.city" | "address.zip"
    >();
  });

  test("invalid keys are a type error", () => {
    // @ts-expect-error "missing" is not a key of User
    DeepPick(User, ["missing"]);
    // @ts-expect-error "address.missing" is not a nested key of address
    DeepPick(User, ["address.missing"]);
    // @ts-expect-error "name.foo" is not nestable (name is not an object)
    DeepOmit(User, ["name.foo"]);
  });
});

describe("Value.Clean pipeline (mirrors parseResponse)", () => {
  // Clean removes properties not defined in the schema, then Check confirms the
  // cleaned value validates. This is the pipeline used by parseResponse.
  const clean = <S extends T.TSchema>(schema: S, value: unknown) => {
    const cleaned = Value.Clean(schema, value);
    expect(Value.Check(schema, cleaned)).toBe(true);
    return cleaned;
  };

  test("DeepPick: Clean strips unpicked top-level properties", () => {
    const schema = DeepPick(User, ["id", "name"]);
    const cleaned = clean(schema, {
      id: "1",
      name: "Ada",
      address: { street: "x", city: "y", zip: "z" },
    });

    expect(cleaned).toEqual({ id: "1", name: "Ada" });
  });

  test("DeepPick: Clean strips unpicked nested properties via dot notation", () => {
    const schema = DeepPick(User, ["id", "address.street"]);
    const cleaned = clean(schema, {
      id: "1",
      name: "Ada",
      address: { street: "Main", city: "Springfield", zip: "00000" },
    });

    expect(cleaned).toEqual({ id: "1", address: { street: "Main" } });
  });

  test("DeepOmit: Clean strips omitted top-level and nested properties", () => {
    const schema = DeepOmit(User, ["name", "address.zip"]);
    const cleaned = clean(schema, {
      id: "1",
      name: "Ada",
      address: { street: "Main", city: "Springfield", zip: "00000" },
    });

    expect(cleaned).toEqual({ id: "1", address: { street: "Main", city: "Springfield" } });
  });

  test("union: Clean strips per matching variant", () => {
    const Shape = T.Union([
      T.Object({ kind: T.Literal("circle"), radius: T.Number() }),
      T.Object({ kind: T.Literal("square"), size: T.Number() }),
    ]);
    const schema = DeepPick(Shape, ["kind", "radius"]);

    // circle keeps the picked radius; square has only kind picked, so size is stripped.
    expect(clean(schema, { kind: "circle", radius: 5, extra: true })).toEqual({
      kind: "circle",
      radius: 5,
    });
    expect(clean(schema, { kind: "square", size: 3 })).toEqual({ kind: "square" });
  });

  test("nested union: Clean strips per matching nested variant", () => {
    const Account = T.Object({
      id: T.String(),
      owner: T.Union([
        T.Object({ type: T.Literal("person"), firstName: T.String(), lastName: T.String() }),
        T.Object({ type: T.Literal("org"), orgName: T.String() }),
      ]),
    });
    const schema = DeepPick(Account, ["id", "owner.type", "owner.firstName"]);

    expect(
      clean(schema, {
        id: "1",
        owner: { type: "person", firstName: "Ada", lastName: "Lovelace" },
      }),
    ).toEqual({ id: "1", owner: { type: "person", firstName: "Ada" } });

    expect(clean(schema, { id: "2", owner: { type: "org", orgName: "ACME" } })).toEqual({
      id: "2",
      owner: { type: "org" },
    });
  });
});
