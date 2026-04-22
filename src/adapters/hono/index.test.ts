import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Hono } from "hono";
import { createContract } from "../../contract";
import { createHonoApp } from "./index";

const contract = createContract("/api", {
  getUser: {
    method: "GET",
    path: "/users/:id",
    params: Type.Object({ id: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String() }),
  },
  createUser: {
    method: "POST",
    path: "/users",
    body: Type.Object({ name: Type.String() }),
    response: Type.Object({ id: Type.String(), name: Type.String() }),
  },
});

describe("hono adapter", () => {
  test("provides Hono context in handler input", async () => {
    const api = createHonoApp(contract);
    api.implement("getUser", ({ params, c }) => {
      expect(c.req).toBeDefined();
      expect(c.req.header("x-test")).toBe("hello");
      return { id: params.id, name: "Alice" };
    });
    api.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    const app = api.build();

    const res = await app.request("/api/users/1", {
      headers: { "x-test": "hello" },
    });
    expect(res.status).toBe(200);
  });

  test("supports basePath override", async () => {
    const api = createHonoApp(contract, { basePath: "/v2" });
    api.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
    api.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    const app = api.build();

    const res = await app.request("/v2/users/1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1", name: "Alice" });
  });

  test("accepts a provided Hono app instance", async () => {
    const hono = new Hono();
    hono.get("/health", (c) => c.json({ ok: true }));

    const api = createHonoApp(hono, contract);
    api.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
    api.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    const app = api.build();

    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ ok: true });

    const userRes = await app.request("/api/users/1");
    expect(userRes.status).toBe(200);
  });

  describe("type inference", () => {
    test("handler params are typed from contract", () => {
      const api = createHonoApp(contract);
      api.implement("getUser", ({ params }) => {
        expectTypeOf(params.id).toEqualTypeOf<string>();
        return { id: params.id, name: "Alice" };
      });
      api.implement("createUser", ({ body }) => {
        expectTypeOf(body.name).toEqualTypeOf<string>();
        return { id: "1", name: body.name };
      });
    });

    test("handler return type matches response schema", () => {
      const api = createHonoApp(contract);
      api.implement("getUser", ({ params }) => {
        type Expected = Static<(typeof contract)["endpoints"]["getUser"]["response"]>;
        type Result = { id: string; name: string };
        expectTypeOf<Result>().toMatchTypeOf<Expected>();
        return { id: params.id, name: "Alice" };
      });
      api.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    });

    test("implement() only accepts valid endpoint names", () => {
      const api = createHonoApp(contract);
      expect(() => {
        // @ts-expect-error — "nonExistent" is not a valid endpoint name
        api.implement("nonExistent", () => ({}));
      }).toThrow();
      api.implement("getUser", ({ params }) => ({ id: params.id, name: "Alice" }));
      api.implement("createUser", ({ body }) => ({ id: "1", name: body.name }));
    });
  });
});
