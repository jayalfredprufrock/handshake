import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { Hono } from "hono";
import * as T from "typebox";
import { createContract } from "../../contract";
import { createHonoApp, implementContract } from "./index";

const usersContract = createContract("/users", {
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

const postsContract = createContract("/posts", {
  getPost: {
    method: "GET",
    path: "/:id",
    params: T.Object({ id: T.String() }),
    response: T.Object({ id: T.String(), title: T.String() }),
  },
});

describe("implementContract", () => {
  test("object form registers all handlers", async () => {
    const users = implementContract(usersContract, {
      getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
      listUsers: () => [{ id: "1", name: "Alice" }],
    });

    const app = createHonoApp([users]);

    const getRes = await app.request("/users/1");
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ id: "1", name: "Alice" });

    const listRes = await app.request("/users");
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual([{ id: "1", name: "Alice" }]);
  });

  test("closure form registers handlers with middleware", async () => {
    const seen: string[] = [];

    const users = implementContract(usersContract, (app) => {
      app.use("*", async (c, next) => {
        seen.push(c.req.path);
        await next();
      });
      app.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
      app.implement("listUsers", () => []);
    });

    const app = createHonoApp([users]);

    await app.request("/users/1");
    await app.request("/users");
    expect(seen).toEqual(["/users/1", "/users"]);
  });

  test("middleware is isolated between route modules", async () => {
    const userHits: string[] = [];
    const postHits: string[] = [];

    const users = implementContract(usersContract, (app) => {
      app.use("*", async (c, next) => {
        userHits.push(c.req.path);
        await next();
      });
      app.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
      app.implement("listUsers", () => []);
    });

    const posts = implementContract(postsContract, (app) => {
      app.use("*", async (c, next) => {
        postHits.push(c.req.path);
        await next();
      });
      app.implement("getPost", ({ params }) => ({ id: params.id, title: "Hello" }));
    });

    const app = createHonoApp([users, posts]);

    await app.request("/users/1");
    await app.request("/posts/1");

    expect(userHits).toEqual(["/users/1"]);
    expect(postHits).toEqual(["/posts/1"]);
  });

  test("createHonoApp accepts an existing Hono with routes", async () => {
    const hono = new Hono();
    hono.get("/health", (c) => c.json({ ok: true }));

    const users = implementContract(usersContract, {
      getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
      listUsers: () => [],
    });

    const app = createHonoApp(hono, [users]);

    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ ok: true });

    const userRes = await app.request("/users/1");
    expect(userRes.status).toBe(200);
  });

  test("throws at build time when object form misses a handler", () => {
    // @ts-expect-error — listUsers handler is missing
    const users = implementContract(usersContract, {
      getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
    });

    expect(() => createHonoApp([users])).toThrow();
  });

  describe("type inference", () => {
    test("object form requires all contract keys", () => {
      // @ts-expect-error — missing listUsers
      implementContract(usersContract, {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
      });

      implementContract(usersContract, {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
        listUsers: () => [],
        // @ts-expect-error — extra key not in contract
        bogus: () => null,
      });

      implementContract(usersContract, {
        getUser: ({ params }) => ({ id: params.id, name: "Alice" }),
        listUsers: () => [],
      });
    });

    test("object form handler params are typed from contract", () => {
      implementContract(usersContract, {
        getUser: ({ params }) => {
          expectTypeOf(params.id).toEqualTypeOf<string>();
          return { id: params.id, name: "Alice" };
        },
        listUsers: () => [],
      });
    });
  });
});
