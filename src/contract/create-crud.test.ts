import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import * as Value from "typebox/value";
import { createCrud } from "./create-crud";

const User = T.Object({
  id: T.String(),
  name: T.String(),
  password: T.String(),
  profile: T.Object({
    bio: T.String(),
    secretToken: T.String(),
  }),
});

describe("createCrud with nested keys", () => {
  const crud = createCrud(User, {
    params: ["id"],
    hidden: ["password", "profile.secretToken"],
    readonly: ["id"],
  });

  test("path is built from params", () => {
    expect(crud.get.path).toBe("/:id");
    expect(crud.list.path).toBe("/");
  });

  test("response hides top-level and nested hidden keys", () => {
    expect(Object.keys(crud.get.response.properties).sort()).toEqual(["id", "name", "profile"]);
    expect(Object.keys(crud.get.response.properties.profile.properties)).toEqual(["bio"]);

    expectTypeOf<Static<typeof crud.get.response>>().toEqualTypeOf<{
      id: string;
      name: string;
      profile: { bio: string };
    }>();
  });

  test("create body also omits readonly keys", () => {
    expect(Object.keys(crud.create.body.properties).sort()).toEqual(["name", "profile"]);

    expectTypeOf<Static<typeof crud.create.body>>().toEqualTypeOf<{
      name: string;
      profile: { bio: string };
    }>();
  });

  test("Value.Clean strips hidden top-level and nested properties from a response", () => {
    const cleaned = Value.Clean(crud.get.response, {
      id: "1",
      name: "Ada",
      password: "hunter2",
      profile: { bio: "math", secretToken: "xyz" },
    });

    expect(cleaned).toEqual({ id: "1", name: "Ada", profile: { bio: "math" } });
    expect(Value.Check(crud.get.response, cleaned)).toBe(true);
  });
});

describe("createCrud with a union schema (non-shared members)", () => {
  const Animal = T.Union([
    T.Object({ kind: T.Literal("dog"), bark: T.Boolean(), secret: T.String() }),
    T.Object({ kind: T.Literal("cat"), meow: T.Boolean() }),
  ]);

  const crud = createCrud(Animal, {
    params: ["kind"],
    hidden: ["secret"],
  });

  test("response omits a key present on only one union member", () => {
    expect(crud.get.response.anyOf).toHaveLength(2);

    expectTypeOf<Static<typeof crud.get.response>>().toEqualTypeOf<
      { kind: "dog"; bark: boolean } | { kind: "cat"; meow: boolean }
    >();
  });

  test("params are picked across union members", () => {
    expectTypeOf<Static<typeof crud.get.params>>().toEqualTypeOf<
      { kind: "dog" } | { kind: "cat" }
    >();
  });

  test("Value.Clean removes the hidden key per matching variant", () => {
    expect(Value.Clean(crud.get.response, { kind: "dog", bark: true, secret: "shh" })).toEqual({
      kind: "dog",
      bark: true,
    });
    expect(Value.Clean(crud.get.response, { kind: "cat", meow: true })).toEqual({
      kind: "cat",
      meow: true,
    });
  });
});
