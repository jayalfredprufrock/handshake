import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import { ApiError } from "./api-error";
import { createContract, makeErrorFactory } from "./create-contract";

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

describe("makeErrorFactory (standalone)", () => {
  test("builds the same typed factory contract.error exposes", () => {
    const error = makeErrorFactory(errors);
    const err = error("CONFLICT", "id conflict", { conflictingId: "7" });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CONFLICT");
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ conflictingId: "7" });
  });

  test("framework codes are available without declaring any errors", () => {
    const error = makeErrorFactory();
    const v = error("VALIDATION_ERROR", "bad");
    expect(v.code).toBe("VALIDATION_ERROR");
    expect(v.status).toBe(400);

    const u = error("UNKNOWN_ERROR", "boom");
    expect(u.status).toBe(500);
  });

  test("throws on reserved codes and unknown codes", () => {
    expect(() => makeErrorFactory({ VALIDATION_ERROR: { status: 400 } })).toThrow(/reserved/);
    // unknown code is a runtime guard for callers reaching past the types
    expect(() => (makeErrorFactory(errors) as (...a: unknown[]) => unknown)("NOPE", "x")).toThrow(
      /Unknown error code/,
    );
  });

  test("the same map shared with createContract yields matching codes/statuses", () => {
    const error = makeErrorFactory(errors);
    const contract = createContract(
      { create: { method: "POST", path: "/", response: T.Null() } },
      { errors },
    );
    const fromFactory = error("NOT_FOUND", "missing");
    const fromContract = contract.error("NOT_FOUND", "missing");
    expect(fromFactory.code).toBe(fromContract.code);
    expect(fromFactory.status).toBe(fromContract.status);
  });

  test("enforces declared codes and details at compile time", () => {
    const error = makeErrorFactory(errors);
    void (() => {
      // @ts-expect-error "NOPE" is not a declared error code
      error("NOPE", "msg");
      // @ts-expect-error CONFLICT requires a details payload
      error("CONFLICT", "msg");
      const ok = error("CONFLICT", "msg", { conflictingId: "1" });
      expectTypeOf(ok.details).toEqualTypeOf<{ conflictingId: string }>();
    });
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

  test("an array of codes matches any (logical OR) and narrows to their union", () => {
    const conflict: unknown = contract.error("CONFLICT", "id conflict", { conflictingId: "7" });
    const notFound: unknown = contract.error("NOT_FOUND", "missing");

    expect(contract.isError(conflict, ["CONFLICT", "NOT_FOUND"])).toBe(true);
    expect(contract.isError(notFound, ["CONFLICT", "NOT_FOUND"])).toBe(true);
    expect(contract.isError(notFound, ["CONFLICT", "UNAUTHORIZED"])).toBe(false);
    expect(contract.isError(new Error("x"), ["CONFLICT"])).toBe(false);
    expect(contract.isError(conflict, [])).toBe(false); // empty array matches nothing

    if (contract.isError(conflict, ["CONFLICT", "NOT_FOUND"])) {
      expectTypeOf(conflict.code).toEqualTypeOf<"CONFLICT" | "NOT_FOUND">();
      if (conflict.code === "CONFLICT") {
        expectTypeOf(conflict.details).toEqualTypeOf<{ conflictingId: string }>();
      }
    }
  });

  test("the array form accepts framework codes too", () => {
    const err: unknown = contract.error("VALIDATION_ERROR", "bad");
    expect(contract.isError(err, ["NOT_FOUND", "VALIDATION_ERROR"])).toBe(true);
    expect(contract.isError(err, ["NOT_FOUND", "CONFLICT"])).toBe(false);
  });

  test("rejects undeclared codes in the array at compile time", () => {
    void (() => {
      // @ts-expect-error "NOPE" is not a declared error code
      contract.isError(null, ["CONFLICT", "NOPE"]);
    });
  });

  test("bare guard narrows the error to the contract's code union", () => {
    const err: unknown = contract.error("NOT_FOUND", "not found");
    if (contract.isError(err)) {
      expectTypeOf(err.code).toEqualTypeOf<
        "UNAUTHORIZED" | "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "UNKNOWN_ERROR"
      >();
      if (err.code === "CONFLICT") {
        expectTypeOf(err.details).toEqualTypeOf<{ conflictingId: string }>();
      }
    }
  });
});

describe("framework error codes (always available)", () => {
  const contract = createContract({ x: { method: "GET", path: "/", response: T.Null() } });

  test("contract.error can throw VALIDATION_ERROR and UNKNOWN_ERROR", () => {
    const v = contract.error("VALIDATION_ERROR", "bad", [
      { path: "name", keyword: "type", message: "must be string" },
    ]);
    expect(v.code).toBe("VALIDATION_ERROR");
    expect(v.status).toBe(400);
    expect(v.details).toEqual([{ path: "name", keyword: "type", message: "must be string" }]);

    const u = contract.error("UNKNOWN_ERROR", "boom");
    expect(u.code).toBe("UNKNOWN_ERROR");
    expect(u.status).toBe(500);
    expect(u.details).toBeUndefined();
  });

  test("isError recognizes and narrows framework codes", () => {
    const err: unknown = contract.error("VALIDATION_ERROR", "bad", [{ message: "nope" }]);
    expect(contract.isError(err)).toBe(true);
    expect(contract.isError(err, "VALIDATION_ERROR")).toBe(true);
    expect(contract.isError(err, "UNKNOWN_ERROR")).toBe(false);
    if (contract.isError(err, "VALIDATION_ERROR")) {
      expectTypeOf(err.details).toEqualTypeOf<
        { path?: string; keyword?: string; message: string }[] | undefined
      >();
    }
  });

  test("VALIDATION_ERROR details are optional", () => {
    const e = contract.error("VALIDATION_ERROR", "Phone is invalid");
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.status).toBe(400);
    expect(e.details).toBeUndefined();
    void (() => {
      // @ts-expect-error when provided, details must be a ValidationIssue[]
      contract.error("VALIDATION_ERROR", "bad", "not an array");
    });
  });

  test("reserved codes still cannot be declared in the error map", () => {
    expect(() =>
      createContract(
        { y: { method: "GET", path: "/", response: T.Null() } },
        { errors: { VALIDATION_ERROR: { status: 400 } } },
      ),
    ).toThrow(/reserved/);
  });
});
