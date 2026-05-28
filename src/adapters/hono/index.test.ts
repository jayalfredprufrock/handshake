import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import type { Endpoint } from "../../contract";
import { createContract } from "../../contract";
import { implementContract, createHonoApp } from "./index";

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

describe("hono adapter", () => {
  test("provides Hono context in handler input", async () => {
    const module = implementContract(contract, {
      getUser: ({ params, c }) => {
        expect(c.req).toBeDefined();
        expect(c.req.header("x-test")).toBe("hello");
        return { id: params.id, name: "Alice" };
      },
      createUser: ({ body }) => ({ id: "1", name: body.name }),
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/api/users/1", {
      headers: { "x-test": "hello" },
    });
    expect(res.status).toBe(200);
  });

  test("implements all endpoints via object form", async () => {
    const module = implementContract(contract, {
      getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
      createUser: ({ body }) => ({ id: "1", name: body.name }),
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/api/users/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", name: "Alice" });
  });

  test("implements all endpoints via closure form", async () => {
    const module = implementContract(contract, (group) => {
      group.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
      group.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/api/users/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", name: "Alice" });
  });

  test("applies middleware in closure form", async () => {
    const calls: string[] = [];
    const module = implementContract(contract, (group) => {
      group.use(async (c, next) => {
        calls.push("middleware");
        await next();
      });
      group.implement("getUser", ({ params }) => {
        calls.push("handler");
        return { id: params.id, name: "Alice" };
      });
      group.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    });
    const app = createHonoApp(contract, [module]);

    await app.request("/api/users/1");
    expect(calls).toEqual(["middleware", "handler"]);
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

    const usersModule = implementContract(usersContract, {
      getUser: ({ params }) => ({ id: params.id }),
    });
    const healthModule = implementContract(healthContract, { health: () => ({ ok: true }) });
    const app = createHonoApp(usersContract, [usersModule, healthModule]);

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
      const { combineContracts } = await import("../../contract");
      const combined = combineContracts(
        { users: usersContract, posts: postsContract },
        { basePath: "/api" },
      );

      const usersModule = implementContract(combined, "users", {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
      });
      const postsModule = implementContract(combined, "posts", {
        listPosts: () => [],
      });
      const app = createHonoApp(combined, [usersModule, postsModule]);

      expect((await app.request("/api/users/1")).status).toBe(200);
      expect(await (await app.request("/api/users/1")).json()).toEqual({ id: "1", name: "Alice" });
      expect((await app.request("/api/posts")).status).toBe(200);
    });

    test("named group closure form with middleware", async () => {
      const { combineContracts } = await import("../../contract");
      const combined = combineContracts({ users: usersContract }, { basePath: "/api" });

      const headerValues: string[] = [];
      const usersModule = implementContract(combined, "users", (group) => {
        group.use(async (c, next) => {
          headerValues.push(c.req.header("x-group") ?? "");
          await next();
        });
        group.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
      });
      const app = createHonoApp(combined, [usersModule]);

      await app.request("/api/users/1", { headers: { "x-group": "users" } });
      expect(headerValues).toEqual(["users"]);
    });
  });

  describe("type inference", () => {
    test("handler params are typed from contract", () => {
      implementContract(contract, {
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
      implementContract(contract, {
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
      const module = implementContract(contract, {
        getUser: ({ params }) => {
          calls.push("handler");
          return { id: params.id, name: "Alice" };
        },
        createUser: ({ body }) => ({ id: "1", name: body.name }),
      });
      const app = createHonoApp(contract, [module], {
        middleware: () => async (_c, next) => {
          calls.push("global");
          await next();
        },
      });

      await app.request("/api/users/1");
      expect(calls).toEqual(["global", "handler"]);
    });

    test("runs global middleware before per-contract middleware", async () => {
      const calls: string[] = [];
      const module = implementContract(contract, (group) => {
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
      const app = createHonoApp(contract, [module], {
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
      const module = implementContract(contract, {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
        createUser: ({ body }) => ({ id: "1", name: body.name }),
      });
      createHonoApp(contract, [module], {
        middleware: (endpoint) => {
          seenEndpoints.push(endpoint);
          return undefined;
        },
      });

      expect(seenEndpoints).toHaveLength(2);
      expect(seenEndpoints.map((e) => e.method).sort()).toEqual(["GET", "POST"]);
    });

    test("skips endpoints where factory returns undefined", async () => {
      const calls: string[] = [];
      const module = implementContract(contract, {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
        createUser: ({ body }) => ({ id: "1", name: body.name }),
      });
      const app = createHonoApp(contract, [module], {
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

  test("throws at implementContract time when a handler is missing", () => {
    expect(() => {
      implementContract(contract, {
        getUser: () => ({ id: "1", name: "Alice" }),
        // createUser missing
      } as any);
    }).toThrow(/Missing handlers/);
  });
});
