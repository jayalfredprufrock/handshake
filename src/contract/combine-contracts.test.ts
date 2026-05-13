import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import { combineContracts } from "./combine-contracts";
import { createContract } from "./create-contract";
import type { ContractErrors } from "./create-contract";

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

  test("stores globalErrors option", () => {
    const GlobalErrors = T.Object({ code: T.Literal("NOT_FOUND") });
    const combined = combineContracts([users], { globalErrors: GlobalErrors });
    expect(combined.globalErrors).toBe(GlobalErrors);
  });

  describe("type inference", () => {
    test("merged endpoints expose all source keys", () => {
      const combined = combineContracts([users, posts]);
      expectTypeOf(combined.endpoints).toHaveProperty("getUser");
      expectTypeOf(combined.endpoints).toHaveProperty("listUsers");
      expectTypeOf(combined.endpoints).toHaveProperty("getPost");
    });

    test("ContractErrors merges globalErrors with per-route errors", () => {
      const GlobalErrors = T.Union([
        T.Object({ code: T.Literal("NOT_FOUND") }),
        T.Object({ code: T.Literal("UNAUTHORIZED") }),
      ]);
      const RouteErrors = T.Object({ code: T.Literal("CONFLICT") });

      const withRouteErrors = createContract({
        createUser: {
          method: "POST",
          path: "/users",
          body: T.Object({ name: T.String() }),
          response: T.Object({ id: T.String() }),
          errors: RouteErrors,
        },
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      });

      const combined = combineContracts([withRouteErrors], { globalErrors: GlobalErrors });

      type Errors = ContractErrors<typeof combined>;

      expectTypeOf<Static<Errors["createUser"]>>().toEqualTypeOf<
        { code: "NOT_FOUND" } | { code: "UNAUTHORIZED" } | { code: "CONFLICT" }
      >();

      expectTypeOf<Static<NonNullable<Errors["getUser"]>>>().toEqualTypeOf<
        { code: "NOT_FOUND" } | { code: "UNAUTHORIZED" }
      >();
    });
  });
});
