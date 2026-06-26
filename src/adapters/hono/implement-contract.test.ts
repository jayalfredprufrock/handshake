import { describe, expect, test, vi } from "vite-plus/test";
import * as T from "typebox";
import { HTTPException } from "hono/http-exception";
import { createContract, combineContracts, ApiError } from "../../contract";
import { ResponseValidationError } from "../../server";
import { implementContract, createHonoApp } from "./index";

describe("error handling", () => {
  test("ApiError pass-through when body matches a declared error", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { errors: { NOT_FOUND: { status: 404 } } },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw contract.error("NOT_FOUND", "user not found");
      },
    });
    const app = createHonoApp([module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "NOT_FOUND",
      status: 404,
      message: "user not found",
    });
  });

  test("ApiError pass-through for a manually thrown declared error", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { errors: { UNAUTHORIZED: { status: 401 } } },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw new ApiError({ code: "UNAUTHORIZED", status: 401, message: "missing token" });
      },
    });
    const app = createHonoApp([module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "UNAUTHORIZED",
      status: 401,
      message: "missing token",
    });
  });

  test("ApiError pass-through with multiple declared statuses", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { errors: { UNAUTHORIZED: { status: 401 }, NOT_FOUND: { status: 404 } } },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw contract.error("NOT_FOUND", "user not found");
      },
    });
    const app = createHonoApp([module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "NOT_FOUND",
      status: 404,
      message: "user not found",
    });
  });

  test("foreign error routes through onError", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { errors: { INTERNAL_ERROR: { status: 500 } } },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw new Error("Database connection failed");
      },
    });
    const app = createHonoApp([module], {
      onError: () =>
        new ApiError({ code: "INTERNAL_ERROR", status: 500, message: "internal error" }),
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "INTERNAL_ERROR",
      status: 500,
      message: "internal error",
    });
  });

  test("ApiError thrown with an undeclared status routes through onError", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { errors: { NOT_FOUND: { status: 404 }, INTERNAL_ERROR: { status: 500 } } },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw new ApiError({ code: "FORBIDDEN", status: 403 });
      },
    });
    const app = createHonoApp([module], {
      onError: () =>
        new ApiError({ code: "INTERNAL_ERROR", status: 500, message: "internal error" }),
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "INTERNAL_ERROR",
      status: 500,
      message: "internal error",
    });
  });

  test("unhandled error defaults to 500 UNKNOWN_ERROR when no onError", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });

    const module = implementContract(contract, {
      getUser: () => {
        throw new Error("unhandled");
      },
    });
    const app = createHonoApp([module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "UNKNOWN_ERROR",
      status: 500,
      message: "Unknown error",
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test("onError returning nothing falls through to the default", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });

    const module = implementContract(contract, {
      getUser: () => {
        throw new Error("boom");
      },
    });
    const app = createHonoApp([module], { onError: () => undefined });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "UNKNOWN_ERROR",
      status: 500,
      message: "Unknown error",
    });
    errorSpy.mockRestore();
  });

  test("a Hono HTTPException keeps its status instead of becoming UNKNOWN_ERROR", async () => {
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });
    // e.g. a middleware (bearer auth) or the framework throwing an HTTPException
    const module = implementContract(contract, {
      getUser: () => {
        throw new HTTPException(401, { message: "no token" });
      },
    });
    const app = createHonoApp([module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(401); // not collapsed to 500
    expect(await res.text()).toBe("no token");
  });

  test("onError can still convert an HTTPException to a typed ApiError", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { errors: { UNAUTHORIZED: { status: 401 } } },
    );
    const module = implementContract(contract, {
      getUser: () => {
        throw new HTTPException(401, { message: "no token" });
      },
    });
    const app = createHonoApp([module], {
      onError: (err) =>
        err instanceof HTTPException ? contract.error("UNAUTHORIZED", err.message) : undefined,
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "UNAUTHORIZED",
      status: 401,
      message: "no token",
    });
  });

  test("request validation errors use the VALIDATION_ERROR envelope", async () => {
    const contract = createContract({
      createUser: {
        method: "POST",
        path: "/users",
        body: T.Object({ name: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });
    const module = implementContract(contract, { createUser: () => ({ id: "1" }) });
    const app = createHonoApp([module]);

    const res = await app.request("/users", {
      method: "POST",
      body: JSON.stringify({ name: 123 }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      kind: string;
      code: string;
      status: number;
      details: { path?: string; keyword?: string; message: string }[];
    };
    expect(body.kind).toBe("HANDSHAKE");
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.status).toBe(400);
    // details is the normalized { path?, keyword?, message }[] array (no TypeBox internals)
    expect(body.details).toEqual([{ path: "name", keyword: "type", message: "must be string" }]);
  });

  test("a bad response surfaces as UNKNOWN_ERROR but onError can detect why", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });

    // handler returns a response that violates the schema (id should be a string)
    const module = implementContract(contract, {
      getUser: () => ({ id: 123 }) as any,
    });

    let seenIssues: unknown;
    const app = createHonoApp([module], {
      onError: (err) => {
        if (err instanceof ResponseValidationError) {
          seenIssues = err.issues; // log / alert on the real reason
        }
      },
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "UNKNOWN_ERROR",
      status: 500,
      message: "Unknown error",
    }); // client never learns why
    expect(seenIssues).toBeDefined(); // server can
    errorSpy.mockRestore();
  });

  test("onError works with combined contracts", async () => {
    const users = createContract(
      "/users",
      {
        getUser: {
          method: "GET",
          path: "/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { errors: { NOT_FOUND: { status: 404 } } },
    );

    const combined = combineContracts([users], {
      errors: { INTERNAL_ERROR: { status: 500 } },
    });

    const module = implementContract(combined, {
      getUser: () => {
        throw new Error("db error");
      },
    });
    const app = createHonoApp([module], {
      onError: () => new ApiError({ code: "INTERNAL_ERROR", status: 500 }),
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "INTERNAL_ERROR",
      status: 500,
      message: "INTERNAL_ERROR",
    });
  });

  test("onError works with named group combined contracts", async () => {
    const users = createContract("/users", {
      getUser: {
        method: "GET",
        path: "/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });

    const combined = combineContracts(
      { users },
      {
        errors: { INTERNAL_ERROR: { status: 500 } },
      },
    );

    const module = implementContract(combined, "users", {
      getUser: () => {
        throw new Error("db error");
      },
    });
    const app = createHonoApp([module], {
      onError: () => new ApiError({ code: "INTERNAL_ERROR", status: 500 }),
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      kind: "HANDSHAKE",
      code: "INTERNAL_ERROR",
      status: 500,
      message: "INTERNAL_ERROR",
    });
  });

  test("uses responseCode for the success status (default 200)", async () => {
    const contract = createContract({
      createUser: {
        method: "POST",
        path: "/users",
        body: T.Object({ name: T.String() }),
        response: T.Object({ id: T.String() }),
        responseCode: 201,
      },
      listUsers: {
        method: "GET",
        path: "/users",
        response: T.Array(T.Object({ id: T.String() })),
      },
    });

    const module = implementContract(contract, {
      createUser: () => ({ id: "1" }),
      listUsers: () => [],
    });
    const app = createHonoApp([module]);

    const created = await app.request("/users", {
      method: "POST",
      body: JSON.stringify({ name: "Ada" }),
      headers: { "content-type": "application/json" },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: "1" });

    const listed = await app.request("/users");
    expect(listed.status).toBe(200);
  });

  test("validates request headers and passes them to the handler", async () => {
    const contract = createContract({
      secret: {
        method: "GET",
        path: "/secret",
        headers: T.Object({ "x-api-key": T.String() }),
        response: T.Object({ key: T.String() }),
      },
    });
    const module = implementContract(contract, {
      secret: ({ headers }) => ({ key: headers["x-api-key"] }),
    });
    const app = createHonoApp([module]);

    const ok = await app.request("/secret", { headers: { "x-api-key": "abc" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ key: "abc" });

    const missing = await app.request("/secret");
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  test("merges contract-level headers into every route", async () => {
    const contract = createContract(
      {
        a: { method: "GET", path: "/a", response: T.Object({ ok: T.Boolean() }) },
        b: {
          method: "GET",
          path: "/b",
          headers: T.Object({ "x-extra": T.String() }),
          response: T.Object({ ok: T.Boolean() }),
        },
      },
      { headers: T.Object({ "x-tenant": T.String() }) },
    );
    const module = implementContract(contract, {
      a: ({ headers }) => ({ ok: Boolean(headers["x-tenant"]) }),
      b: ({ headers }) => ({ ok: Boolean(headers["x-tenant"] && headers["x-extra"]) }),
    });
    const app = createHonoApp([module]);

    // route `a` inherits the contract-level header
    expect((await app.request("/a", { headers: { "x-tenant": "t1" } })).status).toBe(200);
    expect((await app.request("/a")).status).toBe(400);

    // route `b` requires the merge of contract-level + its own header
    const bOk = await app.request("/b", { headers: { "x-tenant": "t1", "x-extra": "e1" } });
    expect(bOk.status).toBe(200);
    expect(await bOk.json()).toEqual({ ok: true });
    expect((await app.request("/b", { headers: { "x-tenant": "t1" } })).status).toBe(400);
  });

  test("throws at implementContract time when a handler is missing", () => {
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
      },
      listUsers: {
        method: "GET",
        path: "/users",
        response: T.Array(T.Object({ id: T.String() })),
      },
    });

    expect(() => {
      implementContract(contract, {
        getUser: () => ({ id: "1" }),
        // listUsers not implemented
      } as any);
    }).toThrow(/Missing handlers/);
  });
});
