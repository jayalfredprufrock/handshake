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
      { errors: { 404: T.Object({ code: T.Literal("NOT_FOUND") }) } },
    );
    const b = createContract(
      "/b",
      { two: { method: "GET", path: "/", response: T.Null() } },
      { errors: { 409: T.Object({ code: T.Literal("CONFLICT"), conflictingId: T.String() }) } },
    );

    const combined = combineContracts([a, b], {
      errors: { 401: T.Object({ code: T.Literal("UNAUTHORIZED") }) },
    });

    expect(combined.error("NOT_FOUND")).toBeInstanceOf(ApiError);
    expect(combined.error("NOT_FOUND").statusCode).toBe(404);
    expect(combined.error("CONFLICT", { conflictingId: "1" }).statusCode).toBe(409);
    expect(combined.error("UNAUTHORIZED").statusCode).toBe(401);
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
        { errors: { 404: T.Object({ code: T.Literal("NOT_FOUND") }) } },
      );
      const b = createContract(
        "/b",
        { two: { method: "GET", path: "/", response: T.Null() } },
        { errors: { 409: T.Object({ code: T.Literal("CONFLICT"), conflictingId: T.String() }) } },
      );

      const combined = combineContracts([a, b]);
      const err: unknown = combined.error("CONFLICT", { conflictingId: "1" });

      if (combined.isError(err)) {
        expectTypeOf(err.body).toEqualTypeOf<
          { code: "NOT_FOUND" } | { code: "CONFLICT"; conflictingId: string }
        >();
      }
    });
  });
});
