import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import type { Endpoint } from "../../contract";
import { createApi, createContract } from "../../contract";
import { buildRoutes, createHonoApp } from "./index";

const contract = createContract("/api", {
  getUser: {
    method: "GET",
    path: "/users/:id",
    params: T.Object({ id: T.String() }),
    response: T.Object({ id: T.String(), name: T.String() }),
  },
  createUser: {
    method: "POST",
    path: "/users",
    body: T.Object({ name: T.String() }),
    response: T.Object({ id: T.String(), name: T.String() }),
  },
});

const api = createApi("/", { main: contract });

describe("hono adapter", () => {
  test("provides Hono context in handler input", async () => {
    const routes = buildRoutes(api, "main", {
      getUser: ({ params, c }) => {
        expect(c.req).toBeDefined();
        expect(c.req.header("x-test")).toBe("hello");
        return { id: params.id, name: "Alice" };
      },
      createUser: ({ body }) => ({ id: "1", name: body.name }),
    });
    const app = createHonoApp({ routes: [routes] });

    const res = await app.request("/api/users/1", {
      headers: { "x-test": "hello" },
    });
    expect(res.status).toBe(200);
  });

  test("implements all endpoints via object form", async () => {
    const routes = buildRoutes(api, "main", {
      getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
      createUser: ({ body }) => ({ id: "1", name: body.name }),
    });
    const app = createHonoApp({ routes: [routes] });

    const res = await app.request("/api/users/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", name: "Alice" });
  });

  test("implements all endpoints via closure form", async () => {
    const routes = buildRoutes(api, "main", (group) => {
      group.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
      group.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    });
    const app = createHonoApp({ routes: [routes] });

    const res = await app.request("/api/users/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", name: "Alice" });
  });

  test("applies middleware in closure form", async () => {
    const calls: string[] = [];
    const routes = buildRoutes(api, "main", (group) => {
      group.use(async (_c, next) => {
        calls.push("middleware");
        await next();
      });
      group.implement("getUser", ({ params }) => {
        calls.push("handler");
        return { id: params.id, name: "Alice" };
      });
      group.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    });
    const app = createHonoApp({ routes: [routes] });

    // param path
    await app.request("/api/users/1");
    expect(calls).toEqual(["middleware", "handler"]);

    // static path (no path params) — regression: group.use must also run here
    calls.length = 0;
    await app.request("/api/users", {
      method: "POST",
      body: JSON.stringify({ name: "Bob" }),
      headers: { "content-type": "application/json" },
    });
    expect(calls).toEqual(["middleware"]);
  });

  test("assembles multiple modules", async () => {
    const usersContract = createContract("/users", {
      getUser: {
        method: "GET",
        path: "/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });
    const healthContract = createContract({
      health: { method: "GET", path: "/health", response: T.Object({ ok: T.Boolean() }) },
    });

    const multiApi = createApi("/", { users: usersContract, health: healthContract });
    const usersModule = buildRoutes(multiApi, "users", {
      getUser: ({ params }) => ({ id: params.id }),
    });
    const healthModule = buildRoutes(multiApi, "health", { health: () => ({ ok: true }) });
    const app = createHonoApp({ routes: [usersModule, healthModule] });

    expect((await app.request("/users/1")).status).toBe(200);
    expect((await app.request("/health")).status).toBe(200);
  });

  describe("named groups", () => {
    const usersContract = createContract("/users", {
      getUser: {
        method: "GET",
        path: "/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String(), name: T.String() }),
      },
    });
    const postsContract = createContract("/posts", {
      listPosts: {
        method: "GET",
        path: "/",
        response: T.Array(T.Object({ id: T.String() })),
      },
    });

    test("routes named groups at their basePaths", async () => {
      const combined = createApi("/api", {
        users: usersContract,
        posts: postsContract,
      });

      const usersModule = buildRoutes(combined, "users", {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
      });
      const postsModule = buildRoutes(combined, "posts", {
        listPosts: () => [],
      });
      const app = createHonoApp({ routes: [usersModule, postsModule] });

      expect((await app.request("/api/users/1")).status).toBe(200);
      expect(await (await app.request("/api/users/1")).json()).toEqual({ id: "1", name: "Alice" });
      expect((await app.request("/api/posts")).status).toBe(200);
    });

    test("named group closure form with middleware", async () => {
      const combined = createApi("/api", { users: usersContract });

      const headerValues: string[] = [];
      const usersModule = buildRoutes(combined, "users", (group) => {
        group.use(async (c, next) => {
          headerValues.push(c.req.header("x-group") ?? "");
          await next();
        });
        group.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
      });
      const app = createHonoApp({ routes: [usersModule] });

      await app.request("/api/users/1", { headers: { "x-group": "users" } });
      expect(headerValues).toEqual(["users"]);
    });
  });

  describe("type inference", () => {
    test("handler params are typed from contract", () => {
      buildRoutes(api, "main", {
        getUser: ({ params }) => {
          expectTypeOf(params.id).toEqualTypeOf<string>();
          return { id: params.id, name: "Alice" };
        },
        createUser: ({ body }) => {
          expectTypeOf(body.name).toEqualTypeOf<string>();
          return { id: "1", name: body.name };
        },
      });
    });

    test("handler return type matches response schema", () => {
      buildRoutes(api, "main", {
        getUser: ({ params }) => {
          type Expected = Static<(typeof contract)["endpoints"]["getUser"]["response"]>;
          type Result = { id: string; name: string };
          expectTypeOf<Result>().toMatchTypeOf<Expected>();
          return { id: params.id, name: "Alice" };
        },
        createUser: ({ body }) => ({ id: "1", name: body.name }),
      });
    });
  });

  describe("createHonoApp middleware", () => {
    test("runs global middleware for matching endpoints", async () => {
      const calls: string[] = [];
      const routes = buildRoutes(api, "main", {
        getUser: ({ params }) => {
          calls.push("handler");
          return { id: params.id, name: "Alice" };
        },
        createUser: ({ body }) => {
          calls.push("handler");
          return { id: "1", name: body.name };
        },
      });
      const app = createHonoApp({
        routes: [routes],
        middleware: () => async (_c, next) => {
          calls.push("global");
          await next();
        },
      });

      // param path
      await app.request("/api/users/1");
      expect(calls).toEqual(["global", "handler"]);

      // static path (no path params) — regression: this was the reported bug
      calls.length = 0;
      await app.request("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: "Bob" }),
        headers: { "content-type": "application/json" },
      });
      expect(calls).toEqual(["global", "handler"]);
    });

    test("runs global middleware before per-contract middleware", async () => {
      const calls: string[] = [];
      const routes = buildRoutes(api, "main", (group) => {
        group.use(async (_c, next) => {
          calls.push("contract");
          await next();
        });
        group.implement("getUser", ({ params }) => {
          calls.push("handler");
          return { id: params.id, name: "Alice" };
        });
        group.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
      });
      const app = createHonoApp({
        routes: [routes],
        middleware: () => async (_c, next) => {
          calls.push("global");
          await next();
        },
      });

      await app.request("/api/users/1");
      expect(calls).toEqual(["global", "contract", "handler"]);
    });

    test("factory receives endpoint data", async () => {
      const seenEndpoints: Endpoint[] = [];
      const routes = buildRoutes(api, "main", {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
        createUser: ({ body }) => ({ id: "1", name: body.name }),
      });
      createHonoApp({
        routes: [routes],
        middleware: (endpoint) => {
          seenEndpoints.push(endpoint);
          return undefined;
        },
      });

      expect(seenEndpoints).toHaveLength(2);
      expect(seenEndpoints.map((e) => e.method).sort()).toEqual(["GET", "POST"]);
    });

    test("accepts an array of factories, applying each in order", async () => {
      const calls: string[] = [];
      const routes = buildRoutes(api, "main", {
        getUser: ({ params }) => {
          calls.push("handler");
          return { id: params.id, name: "Alice" };
        },
        createUser: ({ body }) => ({ id: "1", name: body.name }),
      });
      const app = createHonoApp({
        routes: [routes],
        middleware: [
          () => async (_c, next) => {
            calls.push("first");
            await next();
          },
          () => async (_c, next) => {
            calls.push("second");
            await next();
          },
        ],
      });

      await app.request("/api/users/1");
      expect(calls).toEqual(["first", "second", "handler"]);
    });

    test("skips endpoints where factory returns undefined", async () => {
      const calls: string[] = [];
      const routes = buildRoutes(api, "main", {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
        createUser: ({ body }) => ({ id: "1", name: body.name }),
      });
      const app = createHonoApp({
        routes: [routes],
        middleware: (endpoint) => {
          if (endpoint.method === "GET") {
            return async (_c, next) => {
              calls.push("global-get");
              await next();
            };
          }
          return undefined;
        },
      });

      await app.request("/api/users/1");
      await app.request("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: "Bob" }),
        headers: { "content-type": "application/json" },
      });
      expect(calls).toEqual(["global-get"]);
    });
  });

  test("throws at build time when a handler is missing", () => {
    expect(() => {
      buildRoutes(api, "main", {
        getUser: () => ({ id: "1", name: "Alice" }),
        // createUser missing
      } as any);
    }).toThrow(/Missing handlers/);
  });
});
