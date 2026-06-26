import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import { ApiError } from "./api-error";
import { createContract } from "./create-contract";

const errors = {
  UNAUTHORIZED: { status: 401 },
  NOT_FOUND: { status: 404 },
  CONFLICT: { status: 409, details: T.Object({ conflictingId: T.String() }) },
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
        { errors: { VALIDATION_ERROR: { status: 400 } } },
      ),
    ).toThrow(/reserved/);
    expect(() =>
      createContract(
        { ping: { method: "GET", path: "/", response: T.Null() } },
        { errors: { UNKNOWN_ERROR: { status: 500 } } },
      ),
    ).toThrow(/reserved/);
  });
});

describe("contract.error", () => {
  const contract = createContract(
    { create: { method: "POST", path: "/", response: T.Null() } },
    { errors },
  );

  test("takes the status from the code's definition", () => {
    const err = contract.error("NOT_FOUND", "user not found");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.message).toBe("user not found");
    expect(err.details).toBeUndefined(); // NOT_FOUND declares no details
  });

  test("carries the typed details payload", () => {
    const err = contract.error("CONFLICT", "id conflict", { conflictingId: "7" });
    expect(err.code).toBe("CONFLICT");
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ conflictingId: "7" });
  });

  test("rejects undeclared codes and bad details at compile time", () => {
    // type-only assertions; never executed
    void (() => {
      // @ts-expect-error "NOPE" is not a declared error code
      contract.error("NOPE", "msg");
      // @ts-expect-error CONFLICT requires a details payload
      contract.error("CONFLICT", "msg");
    });
  });
});

describe("contract.isError", () => {
  const contract = createContract(
    { create: { method: "POST", path: "/", response: T.Null() } },
    { errors },
  );

  test("recognizes ApiError and narrows by code", () => {
    const err: unknown = contract.error("CONFLICT", "id conflict", { conflictingId: "7" });
    expect(contract.isError(err)).toBe(true);
    expect(contract.isError(new Error("x"))).toBe(false);
    expect(contract.isError(err, "CONFLICT")).toBe(true);
    expect(contract.isError(err, "NOT_FOUND")).toBe(false);

    if (contract.isError(err, "CONFLICT")) {
      expectTypeOf(err.code).toEqualTypeOf<"CONFLICT">();
      expectTypeOf(err.details).toEqualTypeOf<{ conflictingId: string }>();
    }
  });

  test("bare guard narrows the error to the contract's code union", () => {
    const err: unknown = contract.error("NOT_FOUND", "not found");
    if (contract.isError(err)) {
      expectTypeOf(err.code).toEqualTypeOf<"UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT">();
      if (err.code === "CONFLICT") {
        expectTypeOf(err.details).toEqualTypeOf<{ conflictingId: string }>();
      }
    }
  });
});
