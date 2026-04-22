import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { Type } from "typebox";
import { combineContracts } from "./combine-contracts";
import { createContract } from "./create-contract";

const users = createContract("/users", {
  getUser: {
    method: "GET",
    path: "/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String() }),
  },
  listUsers: {
    method: "GET",
    path: "/",
    response: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
  },
});

const posts = createContract("/posts", {
  getPost: {
    method: "GET",
    path: "/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String(), title: Type.String() }),
  },
});

describe("combineContracts", () => {
  test("defaults basePath to '/' when omitted", () => {
    const combined = combineContracts([users, posts]);
    expect(combined.basePath).toBe("/");
  });

  test("accepts an explicit basePath", () => {
    const combined = combineContracts("/api", [users, posts]);
    expect(combined.basePath).toBe("/api");
  });

  test("prefixes sub-contract basePath into each endpoint path", () => {
    const combined = combineContracts("/api", [users, posts]);
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
        response: Type.Object({ ok: Type.Boolean() }),
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
        response: Type.Object({ source: Type.Literal("a") }),
      },
    });
    const b = createContract("/b", {
      shared: {
        method: "GET",
        path: "/",
        response: Type.Object({ source: Type.Literal("b") }),
      },
    });
    expect(() => combineContracts([a, b])).toThrow(/Duplicate endpoint name "shared"/);
  });

  describe("type inference", () => {
    test("merged endpoints expose all source keys", () => {
      const combined = combineContracts([users, posts]);
      expectTypeOf(combined.endpoints).toHaveProperty("getUser");
      expectTypeOf(combined.endpoints).toHaveProperty("listUsers");
      expectTypeOf(combined.endpoints).toHaveProperty("getPost");
    });
  });
});
