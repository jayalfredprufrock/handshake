import { describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import * as T from "typebox";
import { createContract, ApiError } from "../contract";
import { createFetchClient } from "../client";

const mockFetch = vi.fn().mockResolvedValue({ id: "1", name: "Alice" });

describe("createFetchClient", () => {
  test("constructs URL with basePath", async () => {
    const contract = createContract("/api/v1", {
      listUsers: {
        method: "GET",
        path: "/users",
        response: T.Array(T.Object({ id: T.String() })),
      },
    });

    const client = createFetchClient(contract, {
      fetch: mockFetch,
      baseUrl: "https://example.com",
    });

    await client.listUsers();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api/v1/users",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("constructs URL without basePath when default", async () => {
    const contract = createContract({
      listUsers: {
        method: "GET",
        path: "/users",
        response: T.Array(T.Object({ id: T.String() })),
      },
    });

    const client = createFetchClient(contract, {
      fetch: mockFetch,
      baseUrl: "https://example.com",
    });

    await client.listUsers();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/users",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("replaces path params in URL", async () => {
    const contract = createContract("/api", {
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });

    const client = createFetchClient(contract, {
      fetch: mockFetch,
      baseUrl: "https://example.com",
    });

    await client.getUser({ id: "42" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api/users/42",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("appends scalar query params to URL", async () => {
    const contract = createContract({
      search: {
        method: "GET",
        path: "/search",
        query: T.Object({ q: T.String(), limit: T.Number() }),
        response: T.Object({ q: T.String() }),
      },
    });

    const client = createFetchClient(contract, {
      fetch: mockFetch,
      baseUrl: "https://example.com",
    });

    await client.search({ query: { q: "hello", limit: 10 } });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/search?q=hello&limit=10",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("serializes array query params as repeated keys", async () => {
    const contract = createContract({
      search: {
        method: "GET",
        path: "/search",
        query: T.Object({
          tags: T.Array(T.String()),
        }),
        response: T.Object({ tags: T.Array(T.String()) }),
      },
    });

    const client = createFetchClient(contract, {
      fetch: mockFetch,
      baseUrl: "https://example.com",
    });

    await client.search({ query: { tags: ["a", "b", "c"] } });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/search?tags=a&tags=b&tags=c",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("handles mixed scalar and array query params", async () => {
    const contract = createContract({
      search: {
        method: "GET",
        path: "/search",
        query: T.Object({
          q: T.String(),
          tags: T.Array(T.String()),
        }),
        response: T.Object({ q: T.String() }),
      },
    });

    const client = createFetchClient(contract, {
      fetch: mockFetch,
      baseUrl: "https://example.com",
    });

    await client.search({ query: { q: "hello", tags: ["a", "b"] } });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/search?q=hello&tags=a&tags=b",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("omits query string when no query provided", async () => {
    const contract = createContract({
      listUsers: {
        method: "GET",
        path: "/users",
        query: T.Object({ limit: T.Optional(T.Number()) }),
        response: T.Array(T.Object({ id: T.String() })),
      },
    });

    const client = createFetchClient(contract, {
      fetch: mockFetch,
      baseUrl: "https://example.com",
    });

    await client.listUsers();

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/users",
      expect.objectContaining({ method: "GET" }),
    );
  });

  describe("isApiError", () => {
    test("returns true for any ApiError on endpoint without declared errors", () => {
      const contract = createContract({
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      });

      const client = createFetchClient(contract, { fetch: mockFetch, baseUrl: "" });
      const err = new ApiError(500, { code: "SOME_ERROR" });

      expect(client.getUser.isApiError(err)).toBe(true);
      expect(client.getUser.isApiError(new Error("plain"))).toBe(false);
    });

    test("narrows to the full effective error union (no code)", () => {
      const NotFound = T.Object({ code: T.Literal("NOT_FOUND"), resource: T.String() });
      const contract = createContract(
        {
          getUser: {
            method: "GET",
            path: "/users/:id",
            params: T.Object({ id: T.String() }),
            response: T.Object({ id: T.String() }),
            errors: NotFound,
          },
        },
        { globalErrors: T.Object({ code: T.Literal("UNAUTHORIZED") }) },
      );

      const client = createFetchClient(contract, { fetch: mockFetch, baseUrl: "" });
      const err: unknown = new ApiError(404, { code: "NOT_FOUND", resource: "user" });

      if (client.getUser.isApiError(err)) {
        expectTypeOf(err.body).toEqualTypeOf<
          { code: "NOT_FOUND"; resource: string } | { code: "UNAUTHORIZED" }
        >();
      }
    });

    test("factory form returns a type guard narrowed to the specified code", () => {
      const contract = createContract(
        {
          getUser: {
            method: "GET",
            path: "/users/:id",
            params: T.Object({ id: T.String() }),
            response: T.Object({ id: T.String() }),
            errors: T.Object({ code: T.Literal("NOT_FOUND"), resource: T.String() }),
          },
        },
        { globalErrors: T.Object({ code: T.Literal("UNAUTHORIZED") }) },
      );

      const client = createFetchClient(contract, { fetch: mockFetch, baseUrl: "" });

      const isNotFound = client.getUser.isApiError("NOT_FOUND");
      const notFoundErr = new ApiError(404, { code: "NOT_FOUND", resource: "user" });
      const unauthorizedErr = new ApiError(401, { code: "UNAUTHORIZED" });

      expect(isNotFound(notFoundErr)).toBe(true);
      expect(isNotFound(unauthorizedErr)).toBe(false);
      expect(isNotFound(new Error("plain"))).toBe(false);
    });

    test("factory form narrows body to the specific variant", () => {
      const contract = createContract(
        {
          getUser: {
            method: "GET",
            path: "/users/:id",
            params: T.Object({ id: T.String() }),
            response: T.Object({ id: T.String() }),
            errors: T.Object({ code: T.Literal("NOT_FOUND"), resource: T.String() }),
          },
        },
        { globalErrors: T.Object({ code: T.Literal("UNAUTHORIZED") }) },
      );

      const client = createFetchClient(contract, { fetch: mockFetch, baseUrl: "" });
      const isNotFound = client.getUser.isApiError("NOT_FOUND");
      const err: unknown = new ApiError(404, { code: "NOT_FOUND", resource: "user" });

      if (isNotFound(err)) {
        expectTypeOf(err.body).toEqualTypeOf<{ code: "NOT_FOUND"; resource: string }>();
      }
    });
  });
});
