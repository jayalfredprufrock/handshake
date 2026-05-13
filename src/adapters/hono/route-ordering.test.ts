import { describe, expect, test } from "vite-plus/test";
import * as T from "typebox";
import { createContract } from "../../contract";
import { implementContract, createHonoApp } from "./index";

describe("route ordering", () => {
  test("literal segment wins over param at the same position", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ source: T.Literal("param"), id: T.String() }),
        },
        getMe: {
          method: "GET",
          path: "/me",
          response: T.Object({ source: T.Literal("literal"), id: T.Literal("me") }),
        },
      },
      { basePath: "/users" },
    );

    const module = implementContract(contract, {
      getUser: ({ params }) => ({ source: "param" as const, id: params.id }),
      getMe: () => ({ source: "literal" as const, id: "me" as const }),
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/users/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "literal", id: "me" });
  });

  test("still matches param routes for non-literal values", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ source: T.Literal("param"), id: T.String() }),
        },
        getMe: {
          method: "GET",
          path: "/me",
          response: T.Object({ source: T.Literal("literal"), id: T.Literal("me") }),
        },
      },
      { basePath: "/users" },
    );

    const module = implementContract(contract, {
      getUser: ({ params }) => ({ source: "param" as const, id: params.id }),
      getMe: () => ({ source: "literal" as const, id: "me" as const }),
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/users/42");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "param", id: "42" });
  });

  test("applies within a single contract", async () => {
    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ source: T.String() }),
        },
        getMe: {
          method: "GET",
          path: "/me",
          response: T.Object({ source: T.String() }),
        },
      },
      { basePath: "/users" },
    );

    const module = implementContract(contract, {
      getUser: () => ({ source: "param" }),
      getMe: () => ({ source: "literal" }),
    });
    const app = createHonoApp(contract, [module]);

    const res = await app.request("/users/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: "literal" });
  });

  test("orders nested literal vs param segments", async () => {
    const contract = createContract({
      userPosts: {
        method: "GET",
        path: "/users/:id/posts",
        params: T.Object({ id: T.String() }),
        response: T.Object({ route: T.Literal("userPosts") }),
      },
      myPosts: {
        method: "GET",
        path: "/users/me/posts",
        response: T.Object({ route: T.Literal("myPosts") }),
      },
    });

    const module = implementContract(contract, {
      userPosts: () => ({ route: "userPosts" as const }),
      myPosts: () => ({ route: "myPosts" as const }),
    });
    const app = createHonoApp(contract, [module]);

    const meRes = await app.request("/users/me/posts");
    expect(await meRes.json()).toEqual({ route: "myPosts" });

    const idRes = await app.request("/users/42/posts");
    expect(await idRes.json()).toEqual({ route: "userPosts" });
  });
});
