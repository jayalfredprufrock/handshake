import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import { ApiError } from "./api-error";
import { combineContracts } from "./combine-contracts";
import { createContract } from "./create-contract";

const users = createContract("/users", {
  getUser: {
    method: "GET",
    path: "/:id",
    params: T.Object({ id: T.String() }),
    response: T.Object({ id: T.String(), name: T.String() }),
  },
  listUsers: {
    method: "GET",
    path: "/",
    response: T.Array(T.Object({ id: T.String(), name: T.String() })),
  },
});

const posts = createContract("/posts", {
  getPost: {
    method: "GET",
    path: "/:id",
    params: T.Object({ id: T.String() }),
    response: T.Object({ id: T.String(), title: T.String() }),
  },
});

describe("combineContracts", () => {
  test("defaults basePath to '/' when omitted", () => {
    const combined = combineContracts([users, posts]);
    expect(combined.basePath).toBe("/");
  });

  test("accepts an explicit basePath option", () => {
    const combined = combineContracts([users, posts], { basePath: "/api" });
    expect(combined.basePath).toBe("/api");
  });

  test("prefixes sub-contract basePath into each endpoint path", () => {
    const combined = combineContracts([users, posts], { basePath: "/api" });
    expect(combined.endpoints.getUser.path).toBe("/users/:id");
    expect(combined.endpoints.listUsers.path).toBe("/users");
    expect(combined.endpoints.getPost.path).toBe("/posts/:id");
  });

  test("collapses '/' endpoint path into the sub-contract basePath", () => {
    const combined = combineContracts([users]);
    expect(combined.endpoints.listUsers.path).toBe("/users");
  });

  test("preserves endpoint when sub-contract basePath is '/'", () => {
    const root = createContract({
      health: {
        method: "GET",
        path: "/health",
        response: T.Object({ ok: T.Boolean() }),
      },
    });
    const combined = combineContracts([root]);
    expect(combined.endpoints.health.path).toBe("/health");
  });

  test("preserves endpoint fields other than path", () => {
    const combined = combineContracts([users]);
    expect(combined.endpoints.getUser.method).toBe("GET");
    expect(combined.endpoints.getUser.params).toBe(users.endpoints.getUser.params);
    expect(combined.endpoints.getUser.response).toBe(users.endpoints.getUser.response);
  });

  test("merges a contract-level default meta into every combined route (route meta wins)", () => {
    const admin = createContract("/admin", {
      purge: { method: "DELETE", path: "/", response: T.Null(), meta: { auth: "admin" } },
    });
    const combined = combineContracts([users, admin], { meta: { auth: "user", tracked: true } });

    // A route without its own meta inherits the default.
    expect(combined.endpoints.getUser.meta).toEqual({ auth: "user", tracked: true });
    // A route with its own meta overrides matching keys, keeps the rest.
    expect(combined.endpoints.purge.meta).toEqual({ auth: "admin", tracked: true });

    expectTypeOf(combined.endpoints.getUser.meta.tracked).toEqualTypeOf<true>();
    expectTypeOf(combined.endpoints.purge.meta.auth).toEqualTypeOf<"admin">();
  });

  test("throws on duplicate endpoint names", () => {
    const a = createContract("/a", {
      shared: {
        method: "GET",
        path: "/",
        response: T.Object({ source: T.Literal("a") }),
      },
    });
    const b = createContract("/b", {
      shared: {
        method: "GET",
        path: "/",
        response: T.Object({ source: T.Literal("b") }),
      },
    });
    expect(() => combineContracts([a, b])).toThrow(/Duplicate endpoint name "shared"/);
  });

  test("merges error maps from each sub-contract and the options", () => {
    const a = createContract(
      "/a",
      { one: { method: "GET", path: "/", response: T.Null() } },
      { errors: { NOT_FOUND: { status: 404 } } },
    );
    const b = createContract(
      "/b",
      { two: { method: "GET", path: "/", response: T.Null() } },
      { errors: { CONFLICT: { status: 409, details: T.Object({ conflictingId: T.String() }) } } },
    );

    const combined = combineContracts([a, b], {
      errors: { UNAUTHORIZED: { status: 401 } },
    });

    expect(combined.error("NOT_FOUND", "not found")).toBeInstanceOf(ApiError);
    expect(combined.error("NOT_FOUND", "not found").status).toBe(404);
    expect(combined.error("CONFLICT", "conflict", { conflictingId: "1" }).status).toBe(409);
    expect(combined.error("UNAUTHORIZED", "unauthorized").status).toBe(401);
  });

  test("throws on duplicate error codes across combined contracts", () => {
    const a = createContract(
      "/a",
      { one: { method: "GET", path: "/", response: T.Null() } },
      { errors: { CONFLICT: { status: 409 } } },
    );
    const b = createContract(
      "/b",
      { two: { method: "GET", path: "/", response: T.Null() } },
      { errors: { CONFLICT: { status: 409 } } },
    );
    expect(() => combineContracts([a, b])).toThrow(/Duplicate error code "CONFLICT"/);
  });

  describe("type inference", () => {
    test("merged endpoints expose all source keys", () => {
      const combined = combineContracts([users, posts]);
      expectTypeOf(combined.endpoints).toHaveProperty("getUser");
      expectTypeOf(combined.endpoints).toHaveProperty("listUsers");
      expectTypeOf(combined.endpoints).toHaveProperty("getPost");
    });

    test("named-record combine result is not dropped when re-combined", () => {
      const named = combineContracts({ users, posts });
      const extra = createContract("/extra", {
        ping: { method: "GET", path: "/ping", response: T.Object({ ok: T.Boolean() }) },
      });
      const combined = combineContracts([named, extra]);
      expectTypeOf(combined.endpoints).toHaveProperty("getUser");
      expectTypeOf(combined.endpoints).toHaveProperty("listUsers");
      expectTypeOf(combined.endpoints).toHaveProperty("getPost");
      expectTypeOf(combined.endpoints).toHaveProperty("ping");
    });

    test("named-record combine result is not dropped when re-combined via named record", () => {
      const named = combineContracts({ users, posts });
      const extra = createContract("/extra", {
        ping: { method: "GET", path: "/ping", response: T.Object({ ok: T.Boolean() }) },
      });
      const combined = combineContracts({ named, extra });
      expectTypeOf(combined.endpoints).toHaveProperty("getUser");
      expectTypeOf(combined.endpoints).toHaveProperty("listUsers");
      expectTypeOf(combined.endpoints).toHaveProperty("getPost");
      expectTypeOf(combined.endpoints).toHaveProperty("ping");
    });

    test("combined isError narrows to the union of all sub-contract errors", () => {
      const a = createContract(
        "/a",
        { one: { method: "GET", path: "/", response: T.Null() } },
        { errors: { NOT_FOUND: { status: 404 } } },
      );
      const b = createContract(
        "/b",
        { two: { method: "GET", path: "/", response: T.Null() } },
        { errors: { CONFLICT: { status: 409, details: T.Object({ conflictingId: T.String() }) } } },
      );

      const combined = combineContracts([a, b]);
      const err: unknown = combined.error("CONFLICT", "conflict", { conflictingId: "1" });

      if (combined.isError(err)) {
        expectTypeOf(err.code).toEqualTypeOf<
          "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "UNKNOWN_ERROR"
        >();
        if (err.code === "CONFLICT") {
          expectTypeOf(err.details).toEqualTypeOf<{ conflictingId: string }>();
        }
      }
    });

    test("error() constrains codes when errors come only from combine-level options", () => {
      // Regression: sub-contracts (users, posts) declare no errors, so their
      // entry is `never`. EntryOf must not widen that `never` to `ErrorEntry`,
      // which previously collapsed the code union to `string` and let any code
      // through.
      const combined = combineContracts([users, posts], {
        errors: { UNAUTHORIZED: { status: 401 } },
      });

      expect(combined.error("UNAUTHORIZED", "unauthorized").status).toBe(401);
      expectTypeOf(combined.error)
        .parameter(0)
        .toEqualTypeOf<"UNAUTHORIZED" | "VALIDATION_ERROR" | "UNKNOWN_ERROR">();
      // @ts-expect-error — undeclared code must be rejected at the type level
      expect(() => combined.error("NOT_A_REAL_CODE", "msg")).toThrow(/Unknown error code/);
    });
  });
});
