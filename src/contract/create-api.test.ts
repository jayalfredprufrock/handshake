import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import type { StaticApi, StaticEndpoint } from "../client";
import type { BaseHandlerInput } from "../server";
import type { TopKeyOf } from "../typebox";
import { createApi } from "./create-api";
import type { Api, ApiBody, ApiHeaders, ApiSchema } from "./create-api";
import { createContract } from "./create-contract";
import type { Contract, Endpoint, InferSchema } from "./create-contract";

const User = T.Object({ id: T.String() });

describe("createApi", () => {
  test("flat endpoint paths are group-prefixed at runtime and typed as string", () => {
    const users = createContract("/users", {
      getUser: { method: "GET", path: "/:id", params: User, response: User },
    });
    const api = createApi({ users });

    expect(api.endpoints.getUser.path).toBe("/users/:id");
    // The group-relative literal ("/:id") would be wrong for the flat view.
    expectTypeOf(api.endpoints.getUser.path).toEqualTypeOf<string>();
    // The group's own view keeps its relative literal path.
    expectTypeOf(api.contracts.users.endpoints.getUser.path).toEqualTypeOf<"/:id">();
  });

  test("rejects endpoint names duplicated across groups", () => {
    const a = createContract("/a", { dup: { method: "GET", path: "/", response: User } });
    const b = createContract("/b", { dup: { method: "POST", path: "/", response: User } });

    // @ts-expect-error `dup` is declared by both groups
    expect(() => createApi({ a, b })).toThrow(/Duplicate endpoint name "dup"/);
    // @ts-expect-error same check on the options overload
    expect(() => createApi("/", { a, b }, { meta: { x: 1 } })).toThrow(/Duplicate/);
  });

  test("accepts contracts annotated with the default error entries", () => {
    const users: Contract<{ list: { method: "GET"; path: "/"; response: typeof User } }> =
      createContract({ list: { method: "GET", path: "/", response: User } });
    const api = createApi({ users });
    expectTypeOf(api).toExtend<Api<any, any>>();
    // Framework codes are always available, even with no declared errors.
    expect(api.error("UNKNOWN_ERROR", "boom").status).toBe(500);
  });

  test("concrete apis are assignable to the loose bounds adapters accept", () => {
    const users = createContract("/users", {
      getUser: { method: "GET", path: "/:id", params: User, response: User },
    });
    const api = createApi({ users });
    // Plain assignments: a `never` endpoint map on the loose side would reject these.
    const loose: Api<any, any> = api;
    const bare: Api = api;
    expect([loose, bare]).toHaveLength(2);
    expectTypeOf<Api<any, any>["endpoints"]>().toEqualTypeOf<Record<string, Endpoint>>();
    expectTypeOf<Api["endpoints"]>().toEqualTypeOf<Record<string, Endpoint>>();
  });

  test("an api with no groups is still a valid Api", () => {
    expectTypeOf(createApi({})).toExtend<Api<any, any>>();
  });

  test("api and contract defaults merge into every endpoint, in both views", () => {
    const users = createContract(
      "/users",
      {
        getUser: {
          method: "GET",
          path: "/:id",
          params: User,
          headers: T.Object({ "x-a": T.String() }),
          meta: { own: 1 },
          response: User,
        },
      },
      {
        errors: { NOT_FOUND: { status: 404 } },
        headers: T.Object({ "x-tenant": T.String() }),
        meta: { auth: true },
        client: { credentials: "include" },
      },
    );
    const api = createApi(
      "/api",
      { users },
      { headers: T.Object({ "x-req": T.String() }), meta: { v: 1 }, client: { mode: "cors" } },
    );

    for (const endpoint of [api.endpoints.getUser, api.contracts.users.endpoints.getUser]) {
      expect(endpoint.meta).toEqual({ v: 1, auth: true, own: 1 });
      expect(endpoint.client).toEqual({ mode: "cors", credentials: "include" });
      expect(Object.keys(endpoint.headers.properties).sort()).toEqual(["x-a", "x-req", "x-tenant"]);
    }

    const flat = api.endpoints.getUser;
    expectTypeOf(flat.meta.v).toEqualTypeOf<1>();
    expectTypeOf(flat.meta.auth).toEqualTypeOf<true>();
    expectTypeOf(flat.meta.own).toEqualTypeOf<1>();
    expectTypeOf(flat.client.credentials).toEqualTypeOf<"include">();
    expectTypeOf(flat.client.mode).toEqualTypeOf<"cors">();
    expectTypeOf<Static<typeof flat.headers>>().toEqualTypeOf<{
      "x-a": string;
      "x-tenant": string;
      "x-req": string;
    }>();
    expectTypeOf(api.contracts.users.endpoints.getUser.meta.v).toEqualTypeOf<1>();

    // Declared group errors flow into the api's error factory.
    expect(api.error("NOT_FOUND", "nope").status).toBe(404);
    // @ts-expect-error "NOPE" is not a declared error code
    expect(() => api.error("NOPE", "x")).toThrow();
  });
});

describe("type helpers", () => {
  const users = createContract("/users", {
    getUser: {
      method: "GET",
      path: "/:id",
      params: User,
      headers: T.Object({ "x-a": T.String() }),
      response: User,
    },
    createUser: { method: "POST", path: "/", body: User, response: User },
  });
  const api = createApi({ users });
  type Endpoints = typeof api.endpoints;

  test("an undeclared schema field is undefined, not any", () => {
    expectTypeOf<ApiBody<typeof api>["getUser"]>().toEqualTypeOf<undefined>();
    expectTypeOf<ApiBody<typeof api>["createUser"]>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<StaticEndpoint<Endpoints["getUser"]>["query"]>().toEqualTypeOf<undefined>();
    expectTypeOf<InferSchema<undefined>>().toEqualTypeOf<undefined>();
    // `any` passes through so loosely-typed code is unaffected.
    expectTypeOf<InferSchema<any>>().toBeAny();
  });

  test("headers are extracted alongside the other schema fields", () => {
    expectTypeOf<ApiHeaders<typeof api>["getUser"]>().toEqualTypeOf<{ "x-a": string }>();
    expectTypeOf<ApiSchema<typeof api>["getUser"]["headers"]>().toEqualTypeOf<{
      "x-a": string;
    }>();
    expectTypeOf<StaticEndpoint<Endpoints["getUser"]>["headers"]>().toEqualTypeOf<{
      "x-a": string;
    }>();
    expectTypeOf<BaseHandlerInput<Endpoints["getUser"]>>().toEqualTypeOf<
      { params: { id: string } } & { headers: { "x-a": string } }
    >();
  });

  test("StaticApi only accepts declared endpoint names", () => {
    expectTypeOf<StaticApi<Endpoints, "getUser">["params"]>().toEqualTypeOf<{ id: string }>();
    // @ts-expect-error "getUsr" is not an endpoint
    expectTypeOf<StaticApi<Endpoints, "getUsr">>().toBeNever();
  });

  test("TopKeyOf collects top-level keys across union members, skipping dotted keys", () => {
    const Schema = T.Union([
      T.Object({ id: T.String(), nested: T.Object({ x: T.String() }) }),
      T.Object({ id: T.String(), other: T.Number(), "a.b": T.String() }),
    ]);
    expectTypeOf<TopKeyOf<typeof Schema>>().toEqualTypeOf<"id" | "nested" | "other">();
  });
});
