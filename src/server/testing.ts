import { describe, expect, test } from "vite-plus/test";
import { Type } from "typebox";
import { createContract } from "../contract";
import type { AdapterFactory } from "./types";

export function runAdapterTests(createAdapter: AdapterFactory) {
  const crudContract = createContract("/api", {
    getUser: {
      method: "GET",
      path: "/users/:id",
      params: Type.Object({ id: Type.String() }),
      response: Type.Object({ id: Type.String(), name: Type.String() }),
    },
    listUsers: {
      method: "GET",
      path: "/users",
      query: Type.Object({ limit: Type.Optional(Type.String()) }),
      response: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
    },
    createUser: {
      method: "POST",
      path: "/users",
      body: Type.Object({ name: Type.String() }),
      response: Type.Object({ id: Type.String(), name: Type.String() }),
    },
    updateUser: {
      method: "PATCH",
      path: "/users/:id",
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({ name: Type.Optional(Type.String()) }),
      response: Type.Object({ id: Type.String(), name: Type.String() }),
    },
    deleteUser: {
      method: "DELETE",
      path: "/users/:id",
      params: Type.Object({ id: Type.String() }),
      response: Type.Object({ id: Type.String() }),
    },
  });

  function registerCrudHandlers(api: ReturnType<typeof createAdapter>) {
    api.handle("getUser", ({ params }: any) => ({ id: params.id, name: "Alice" }));
    api.handle("listUsers", () => [{ id: "1", name: "Alice" }]);
    api.handle("createUser", ({ body }: any) => ({ id: "2", name: body.name }));
    api.handle("updateUser", ({ params, body }: any) => ({
      id: params.id,
      name: body.name ?? "Alice",
    }));
    api.handle("deleteUser", ({ params }: any) => ({ id: params.id }));
  }

  describe("adapter compliance", () => {
    describe("routing", () => {
      test("routes GET requests", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users/1");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "1", name: "Alice" });
      });

      test("routes POST requests with JSON body", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Bob" }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "2", name: "Bob" });
      });

      test("routes PATCH requests with params and body", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users/5", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated" }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "5", name: "Updated" });
      });

      test("routes DELETE requests", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users/3", { method: "DELETE" });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "3" });
      });

      test("handles contract with default basePath", async () => {
        const simpleContract = createContract({
          health: {
            method: "GET",
            path: "/health",
            response: Type.Object({ ok: Type.Boolean() }),
          },
        });

        const api = createAdapter(simpleContract);
        api.handle("health", () => ({ ok: true }));
        const app = api.build();

        const res = await app.request("/health");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      });
    });

    describe("response handling", () => {
      test("wraps plain objects as JSON", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users/1");
        expect(res.headers.get("content-type")).toContain("application/json");
      });

      test("passes through raw Response objects", async () => {
        const api = createAdapter(crudContract);
        api.handle("getUser", () => new Response("custom", { status: 418 }));
        api.handle("listUsers", () => []);
        api.handle("createUser", ({ body }: any) => ({ id: "1", name: body.name }));
        api.handle("updateUser", ({ params }: any) => ({ id: params.id, name: "Alice" }));
        api.handle("deleteUser", ({ params }: any) => ({ id: params.id }));
        const app = api.build();

        const res = await app.request("/api/users/1");
        expect(res.status).toBe(418);
        expect(await res.text()).toBe("custom");
      });
    });

    describe("error handling", () => {
      test("throws on build() when handlers are missing", () => {
        const api = createAdapter(crudContract);
        api.handle("getUser", ({ params }: any) => ({ id: params.id, name: "Alice" }));

        expect(() => api.build()).toThrow(/Missing handlers for endpoints/);
      });

      test("throws when registering unknown endpoint", () => {
        const api = createAdapter(crudContract);

        expect(() => {
          api.handle("nonExistent", () => ({}));
        }).toThrow(/Unknown endpoint "nonExistent"/);
      });
    });

    describe("param validation and coercion", () => {
      const numericContract = createContract({
        getItem: {
          method: "GET",
          path: "/items/:id",
          params: Type.Object({ id: Type.Number() }),
          response: Type.Object({ id: Type.Number() }),
        },
        getItemVersion: {
          method: "GET",
          path: "/items/:id/versions/:version",
          params: Type.Object({ id: Type.Number(), version: Type.Number() }),
          response: Type.Object({ id: Type.Number(), version: Type.Number() }),
        },
      });

      test("coerces string path params to numbers", async () => {
        const api = createAdapter(numericContract);
        api.handle("getItem", ({ params }: any) => ({ id: params.id }));
        api.handle("getItemVersion", ({ params }: any) => ({
          id: params.id,
          version: params.version,
        }));
        const app = api.build();

        const res = await app.request("/items/42");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: 42 });
      });

      test("coerces multiple path params", async () => {
        const api = createAdapter(numericContract);
        api.handle("getItem", ({ params }: any) => ({ id: params.id }));
        api.handle("getItemVersion", ({ params }: any) => ({
          id: params.id,
          version: params.version,
        }));
        const app = api.build();

        const res = await app.request("/items/5/versions/3");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: 5, version: 3 });
      });

      test("returns 400 for invalid path params", async () => {
        const api = createAdapter(numericContract);
        api.handle("getItem", ({ params }: any) => ({ id: params.id }));
        api.handle("getItemVersion", ({ params }: any) => ({
          id: params.id,
          version: params.version,
        }));
        const app = api.build();

        const res = await app.request("/items/not-a-number");
        expect(res.status).toBe(400);
      });

      test("passes string params through unchanged when schema expects strings", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users/abc");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "abc", name: "Alice" });
      });

      test("coerces string to integer", async () => {
        const intContract = createContract({
          getItem: {
            method: "GET",
            path: "/items/:id",
            params: Type.Object({ id: Type.Integer() }),
            response: Type.Object({ id: Type.Integer() }),
          },
        });

        const api = createAdapter(intContract);
        api.handle("getItem", ({ params }: any) => ({ id: params.id }));
        const app = api.build();

        const res = await app.request("/items/7");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: 7 });
      });

      test("coerces string to boolean", async () => {
        const boolContract = createContract({
          getFlag: {
            method: "GET",
            path: "/flags/:enabled",
            params: Type.Object({ enabled: Type.Boolean() }),
            response: Type.Object({ enabled: Type.Boolean() }),
          },
        });

        const api = createAdapter(boolContract);
        api.handle("getFlag", ({ params }: any) => ({ enabled: params.enabled }));
        const app = api.build();

        const res = await app.request("/flags/true");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ enabled: true });
      });
    });

    describe("query validation and coercion", () => {
      const searchContract = createContract({
        search: {
          method: "GET",
          path: "/search",
          query: Type.Object({
            q: Type.String(),
            page: Type.Number(),
            limit: Type.Number(),
          }),
          response: Type.Object({
            q: Type.String(),
            page: Type.Number(),
            limit: Type.Number(),
          }),
        },
      });

      test("coerces string query params to numbers", async () => {
        const api = createAdapter(searchContract);
        api.handle("search", ({ query }: any) => ({
          q: query.q,
          page: query.page,
          limit: query.limit,
        }));
        const app = api.build();

        const res = await app.request("/search?q=hello&page=2&limit=10");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ q: "hello", page: 2, limit: 10 });
      });

      test("returns 400 for invalid query params", async () => {
        const api = createAdapter(searchContract);
        api.handle("search", ({ query }: any) => ({
          q: query.q,
          page: query.page,
          limit: query.limit,
        }));
        const app = api.build();

        const res = await app.request("/search?q=hello&page=abc&limit=10");
        expect(res.status).toBe(400);
      });

      test("returns 400 for missing required query params", async () => {
        const api = createAdapter(searchContract);
        api.handle("search", ({ query }: any) => ({
          q: query.q,
          page: query.page,
          limit: query.limit,
        }));
        const app = api.build();

        const res = await app.request("/search?q=hello");
        expect(res.status).toBe(400);
      });

      test("coerces boolean query params", async () => {
        const filterContract = createContract({
          list: {
            method: "GET",
            path: "/items",
            query: Type.Object({ active: Type.Boolean() }),
            response: Type.Object({ active: Type.Boolean() }),
          },
        });

        const api = createAdapter(filterContract);
        api.handle("list", ({ query }: any) => ({ active: query.active }));
        const app = api.build();

        const res = await app.request("/items?active=true");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ active: true });
      });

      test("passes string query params through unchanged", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users?limit=5");
        expect(res.status).toBe(200);
      });

      test("handles array query params from repeated keys", async () => {
        const tagContract = createContract({
          search: {
            method: "GET",
            path: "/search",
            query: Type.Object({ tags: Type.Array(Type.String()) }),
            response: Type.Object({ tags: Type.Array(Type.String()) }),
          },
        });

        const api = createAdapter(tagContract);
        api.handle("search", ({ query }: any) => ({ tags: query.tags }));
        const app = api.build();

        const res = await app.request("/search?tags=a&tags=b&tags=c");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tags: ["a", "b", "c"] });
      });

      test("coerces single value into array when schema expects array", async () => {
        const tagContract = createContract({
          search: {
            method: "GET",
            path: "/search",
            query: Type.Object({ tags: Type.Array(Type.String()) }),
            response: Type.Object({ tags: Type.Array(Type.String()) }),
          },
        });

        const api = createAdapter(tagContract);
        api.handle("search", ({ query }: any) => ({ tags: query.tags }));
        const app = api.build();

        const res = await app.request("/search?tags=solo");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ tags: ["solo"] });
      });

      test("coerces array items to numbers", async () => {
        const idsContract = createContract({
          getMany: {
            method: "GET",
            path: "/items",
            query: Type.Object({ ids: Type.Array(Type.Number()) }),
            response: Type.Object({ ids: Type.Array(Type.Number()) }),
          },
        });

        const api = createAdapter(idsContract);
        api.handle("getMany", ({ query }: any) => ({ ids: query.ids }));
        const app = api.build();

        const res = await app.request("/items?ids=1&ids=2&ids=3");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ids: [1, 2, 3] });
      });

      test("errors when scalar param receives multiple values", async () => {
        const api = createAdapter(searchContract);
        api.handle("search", ({ query }: any) => ({
          q: query.q,
          page: query.page,
          limit: query.limit,
        }));
        const app = api.build();

        const res = await app.request("/search?q=hello&q=world&page=1&limit=10");
        expect(res.status).toBe(400);
      });

      test("handles mix of array and scalar query params", async () => {
        const mixedContract = createContract({
          search: {
            method: "GET",
            path: "/search",
            query: Type.Object({
              q: Type.String(),
              tags: Type.Array(Type.String()),
              limit: Type.Number(),
            }),
            response: Type.Object({
              q: Type.String(),
              tags: Type.Array(Type.String()),
              limit: Type.Number(),
            }),
          },
        });

        const api = createAdapter(mixedContract);
        api.handle("search", ({ query }: any) => ({
          q: query.q,
          tags: query.tags,
          limit: query.limit,
        }));
        const app = api.build();

        const res = await app.request("/search?q=hello&tags=a&tags=b&limit=5");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          q: "hello",
          tags: ["a", "b"],
          limit: 5,
        });
      });
    });

    describe("body validation", () => {
      test("accepts valid request body", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Bob" }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "2", name: "Bob" });
      });

      test("returns 400 for missing required body properties", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      });

      test("returns 400 for extra body properties", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Bob", admin: true }),
        });
        expect(res.status).toBe(400);
      });

      test("returns 400 for wrong body property types", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: 123 }),
        });
        expect(res.status).toBe(400);
      });

      test("accepts optional body properties when absent", async () => {
        const api = createAdapter(crudContract);
        registerCrudHandlers(api);
        const app = api.build();

        const res = await app.request("/api/users/1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
      });
    });

    describe("response validation", () => {
      const responseContract = createContract({
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: Type.Object({ id: Type.String() }),
          response: Type.Object({ id: Type.String(), name: Type.String() }),
        },
      });

      test("strips unknown properties from response", async () => {
        const api = createAdapter(responseContract);
        api.handle("getUser", ({ params }: any) => ({
          id: params.id,
          name: "Alice",
          secret: "should-be-stripped",
        }));
        const app = api.build();

        const res = await app.request("/users/1");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ id: "1", name: "Alice" });
        expect(body).not.toHaveProperty("secret");
      });

      test("returns 500 when known response properties have wrong type", async () => {
        const api = createAdapter(responseContract);
        api.handle("getUser", (() => ({ id: 123, name: "Alice" })) as any);
        const app = api.build();

        const res = await app.request("/users/1");
        expect(res.status).toBe(500);
      });

      test("returns 500 when required response properties are missing", async () => {
        const api = createAdapter(responseContract);
        api.handle("getUser", (() => ({ id: "1" })) as any);
        const app = api.build();

        const res = await app.request("/users/1");
        expect(res.status).toBe(500);
      });

      test("can be disabled globally", async () => {
        const api = createAdapter(responseContract, { validateResponse: false });
        api.handle("getUser", ({ params }: any) => ({
          id: params.id,
          name: "Alice",
          secret: "not-stripped",
        }));
        const app = api.build();

        const res = await app.request("/users/1");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("secret", "not-stripped");
      });

      test("can be disabled per handler", async () => {
        const api = createAdapter(responseContract);
        api.handle(
          "getUser",
          ({ params }: any) => ({
            id: params.id,
            name: "Alice",
            secret: "not-stripped",
          }),
          { validateResponse: false },
        );
        const app = api.build();

        const res = await app.request("/users/1");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("secret", "not-stripped");
      });

      test("per-handler option overrides global option", async () => {
        const api = createAdapter(responseContract, { validateResponse: false });
        api.handle(
          "getUser",
          ({ params }: any) => ({
            id: params.id,
            name: "Alice",
            secret: "should-be-stripped",
          }),
          { validateResponse: true },
        );
        const app = api.build();

        const res = await app.request("/users/1");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ id: "1", name: "Alice" });
        expect(body).not.toHaveProperty("secret");
      });

      test("does not validate Response passthrough", async () => {
        const api = createAdapter(responseContract);
        api.handle("getUser", () => new Response("custom", { status: 200 }));
        const app = api.build();

        const res = await app.request("/users/1");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("custom");
      });
    });
  });
}
