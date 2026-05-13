import { describe, expect, test } from "vite-plus/test";
import * as T from "typebox";
import { createContract, combineContracts, ApiError } from "../../contract";
import { implementContract, createHonoApp } from "./index";

describe("error handling", () => {
  test("ApiError pass-through when body matches route errors", async () => {
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
        errors: T.Object({ code: T.Literal("NOT_FOUND") }),
      },
    });

    const module = implementContract(contract, {
      getUser: () => {
        throw new ApiError(404, { code: "NOT_FOUND" });
      },
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "NOT_FOUND" });
  });

  test("ApiError pass-through when body matches globalErrors", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { globalErrors: T.Object({ code: T.Literal("UNAUTHORIZED") }) },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw new ApiError(401, { code: "UNAUTHORIZED" });
      },
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "UNAUTHORIZED" });
  });

  test("ApiError pass-through for union of global and route errors", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
          errors: T.Object({ code: T.Literal("NOT_FOUND") }),
        },
      },
      { globalErrors: T.Object({ code: T.Literal("UNAUTHORIZED") }) },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw new ApiError(404, { code: "NOT_FOUND" });
      },
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "NOT_FOUND" });
  });

  test("foreign error routes through errorHandler", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { globalErrors: T.Object({ code: T.Literal("INTERNAL_ERROR") }) },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw new Error("Database connection failed");
      },
    });
    const app = createHonoApp(contract, [module], {
      errorHandler: () => new ApiError(500, { code: "INTERNAL_ERROR" }),
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "INTERNAL_ERROR" });
  });

  test("ApiError with body not in effective errors routes through errorHandler", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
          errors: T.Object({ code: T.Literal("NOT_FOUND") }),
        },
      },
      { globalErrors: T.Object({ code: T.Literal("INTERNAL_ERROR") }) },
    );

    const module = implementContract(contract, {
      getUser: () => {
        throw new ApiError(403, { code: "FORBIDDEN" });
      },
    });
    const app = createHonoApp(contract, [module], {
      errorHandler: () => new ApiError(500, { code: "INTERNAL_ERROR" }),
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "INTERNAL_ERROR" });
  });

  test("unhandled error re-thrown when no errorHandler", async () => {
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
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
  });

  test("errorHandler works with combined contracts", async () => {
    const users = createContract("/users", {
      getUser: {
        method: "GET",
        path: "/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String() }),
        errors: T.Object({ code: T.Literal("NOT_FOUND") }),
      },
    });

    const combined = combineContracts([users], {
      globalErrors: T.Object({ code: T.Literal("INTERNAL_ERROR") }),
    });

    const module = implementContract(combined, {
      getUser: () => {
        throw new Error("db error");
      },
    });
    const app = createHonoApp(combined, [module], {
      errorHandler: () => new ApiError(500, { code: "INTERNAL_ERROR" }),
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "INTERNAL_ERROR" });
  });

  test("errorHandler works with named group combined contracts", async () => {
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
        globalErrors: T.Object({ code: T.Literal("INTERNAL_ERROR") }),
      },
    );

    const module = implementContract(combined, "users", {
      getUser: () => {
        throw new Error("db error");
      },
    });
    const app = createHonoApp(combined, [module], {
      errorHandler: () => new ApiError(500, { code: "INTERNAL_ERROR" }),
    });

    const res = await app.request("/users/1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "INTERNAL_ERROR" });
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
        getUser: ({ params }) => ({ id: params.id }),
        // listUsers not implemented
      } as any);
    }).toThrow(/Missing handlers/);
  });
});
