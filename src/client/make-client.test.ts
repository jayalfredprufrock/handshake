import { describe, expect, test, vi } from "vite-plus/test";
import { Type } from "typebox";
import { makeContract } from "../contract";
import { createFetchClient } from "../client";

const mockFetch = vi.fn().mockResolvedValue({ id: "1", name: "Alice" });

describe("createFetchClient", () => {
  test("constructs URL with basePath", async () => {
    const contract = makeContract("/api/v1", {
      listUsers: {
        method: "GET",
        path: "/users",
        response: Type.Array(Type.Object({ id: Type.String() })),
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
    const contract = makeContract({
      listUsers: {
        method: "GET",
        path: "/users",
        response: Type.Array(Type.Object({ id: Type.String() })),
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
    const contract = makeContract("/api", {
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: Type.Object({ id: Type.String() }),
        response: Type.Object({ id: Type.String() }),
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
    const contract = makeContract({
      search: {
        method: "GET",
        path: "/search",
        query: Type.Object({ q: Type.String(), limit: Type.Number() }),
        response: Type.Object({ q: Type.String() }),
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
    const contract = makeContract({
      search: {
        method: "GET",
        path: "/search",
        query: Type.Object({
          tags: Type.Array(Type.String()),
        }),
        response: Type.Object({ tags: Type.Array(Type.String()) }),
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
    const contract = makeContract({
      search: {
        method: "GET",
        path: "/search",
        query: Type.Object({
          q: Type.String(),
          tags: Type.Array(Type.String()),
        }),
        response: Type.Object({ q: Type.String() }),
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
    const contract = makeContract({
      listUsers: {
        method: "GET",
        path: "/users",
        query: Type.Object({ limit: Type.Optional(Type.Number()) }),
        response: Type.Array(Type.Object({ id: Type.String() })),
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
});
