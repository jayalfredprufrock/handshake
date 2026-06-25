import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import { ApiError } from "./api-error";
import { createContract } from "./create-contract";

const errors = {
  401: T.Object({ code: T.Literal("UNAUTHORIZED") }),
  404: T.Object({ code: T.Literal("NOT_FOUND") }),
  409: T.Object({ code: T.Literal("CONFLICT"), conflictingId: T.String() }),
};

describe("createContract", () => {
  test("creates contract with default basePath", () => {
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String(), name: T.String() }),
      },
    });

    expect(contract.basePath).toBe("/");
    expect(contract.endpoints.getUser.method).toBe("GET");
    expect(contract.endpoints.getUser.path).toBe("/users/:id");
  });

  test("creates contract with basePath arg", () => {
    const contract = createContract("/api/v1", {
      listUsers: { method: "GET", path: "/users", response: T.Array(T.Object({ id: T.String() })) },
    });

    expect(contract.basePath).toBe("/api/v1");
    expect(contract.endpoints.listUsers.method).toBe("GET");
  });

  test("preserves all endpoint properties", () => {
    const contract = createContract({
      createUser: {
        method: "POST",
        path: "/users",
        body: T.Object({ name: T.String() }),
        response: T.Object({ id: T.String(), name: T.String() }),
        description: "Create a user",
        meta: { auth: true },
      },
    });

    const endpoint = contract.endpoints.createUser;
    expect(endpoint.description).toBe("Create a user");
    expect(endpoint.meta).toEqual({ auth: true });
    expect(endpoint.body).toBeDefined();
  });

  test("stores the errors map", () => {
    const contract = createContract(
      { ping: { method: "GET", path: "/", response: T.Null() } },
      { errors },
    );
    expect(contract.errors).toBe(errors);
  });

  test("throws when a reserved framework code is declared", () => {
    expect(() =>
      createContract(
        { ping: { method: "GET", path: "/", response: T.Null() } },
        { errors: { 400: T.Object({ code: T.Literal("VALIDATION_ERROR") }) } },
      ),
    ).toThrow(/reserved/);
    expect(() =>
      createContract(
        { ping: { method: "GET", path: "/", response: T.Null() } },
        { errors: { 500: T.Object({ code: T.Literal("UNKNOWN_ERROR") }) } },
      ),
    ).toThrow(/reserved/);
  });

  test("throws when error codes collide across statuses", () => {
    expect(() =>
      createContract(
        { ping: { method: "GET", path: "/", response: T.Null() } },
        {
          errors: {
            400: T.Object({ code: T.Literal("BAD") }),
            422: T.Object({ code: T.Literal("BAD") }),
          },
        },
      ),
    ).toThrow(/Duplicate error code "BAD"/);
  });
});

describe("contract.error", () => {
  const contract = createContract(
    { create: { method: "POST", path: "/", response: T.Null() } },
    { errors },
  );

  test("infers the status from the code", () => {
    const err = contract.error("NOT_FOUND");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(404);
    expect(err.body).toEqual({ code: "NOT_FOUND" });
  });

  test("includes typed extra fields", () => {
    const err = contract.error("CONFLICT", { conflictingId: "7" });
    expect(err.statusCode).toBe(409);
    expect(err.body).toEqual({ code: "CONFLICT", conflictingId: "7" });
  });

  test("rejects undeclared codes and bad fields at compile time", () => {
    // type-only assertions; never executed
    void (() => {
      // @ts-expect-error "NOPE" is not a declared error code
      contract.error("NOPE");
      // @ts-expect-error CONFLICT requires conflictingId
      contract.error("CONFLICT");
    });
  });
});

describe("contract.isError", () => {
  const contract = createContract(
    { create: { method: "POST", path: "/", response: T.Null() } },
    { errors },
  );

  test("recognizes ApiError and narrows by code", () => {
    const err: unknown = contract.error("CONFLICT", { conflictingId: "7" });
    expect(contract.isError(err)).toBe(true);
    expect(contract.isError(new Error("x"))).toBe(false);
    expect(contract.isError(err, "CONFLICT")).toBe(true);
    expect(contract.isError(err, "NOT_FOUND")).toBe(false);

    if (contract.isError(err, "CONFLICT")) {
      expectTypeOf(err.body).toEqualTypeOf<{ code: "CONFLICT"; conflictingId: string }>();
    }
  });

  test("bare guard narrows the body to the contract error union", () => {
    const err: unknown = contract.error("NOT_FOUND");
    if (contract.isError(err)) {
      expectTypeOf(err.body).toEqualTypeOf<
        | { code: "UNAUTHORIZED" }
        | { code: "NOT_FOUND" }
        | { code: "CONFLICT"; conflictingId: string }
      >();
    }
  });
});
