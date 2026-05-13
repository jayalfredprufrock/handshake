import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as T from "typebox";
import type { Static } from "typebox";
import { createContract } from "./create-contract";
import type { ContractErrors } from "./create-contract";

describe("createContract", () => {
  test("creates contract with default basePath", () => {
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: T.Object({ id: T.String() }),
        response: T.Object({ id: T.String(), name: T.String() }),
      },
    });

    expect(contract.basePath).toBe("/");
    expect(contract.endpoints.getUser.method).toBe("GET");
    expect(contract.endpoints.getUser.path).toBe("/users/:id");
  });

  test("creates contract with basePath arg", () => {
    const contract = createContract("/api/v1", {
      listUsers: {
        method: "GET",
        path: "/users",
        response: T.Array(T.Object({ id: T.String() })),
      },
    });

    expect(contract.basePath).toBe("/api/v1");
    expect(contract.endpoints.listUsers.method).toBe("GET");
  });

  test("preserves all endpoint properties", () => {
    const contract = createContract({
      createUser: {
        method: "POST",
        path: "/users",
        body: T.Object({ name: T.String() }),
        response: T.Object({ id: T.String(), name: T.String() }),
        description: "Create a user",
        meta: { auth: true },
      },
    });

    const endpoint = contract.endpoints.createUser;
    expect(endpoint.description).toBe("Create a user");
    expect(endpoint.meta).toEqual({ auth: true });
    expect(endpoint.body).toBeDefined();
  });

  test("stores globalErrors option", () => {
    const GlobalErrors = T.Union([
      T.Object({ code: T.Literal("NOT_FOUND") }),
      T.Object({ code: T.Literal("UNAUTHORIZED") }),
    ]);

    const contract = createContract(
      {
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      },
      { globalErrors: GlobalErrors },
    );

    expect(contract.globalErrors).toBe(GlobalErrors);
  });

  test("stores per-route errors", () => {
    const RouteErrors = T.Object({ code: T.Literal("CONFLICT") });

    const contract = createContract({
      createUser: {
        method: "POST",
        path: "/users",
        body: T.Object({ name: T.String() }),
        response: T.Object({ id: T.String() }),
        errors: RouteErrors,
      },
    });

    expect(contract.endpoints.createUser.errors).toBe(RouteErrors);
  });

  describe("type inference", () => {
    test("ContractErrors resolves to effective errors per endpoint", () => {
      const GlobalErrors = T.Union([
        T.Object({ code: T.Literal("NOT_FOUND") }),
        T.Object({ code: T.Literal("UNAUTHORIZED") }),
      ]);
      const RouteErrors = T.Object({ code: T.Literal("CONFLICT") });

      const contract = createContract(
        {
          createUser: {
            method: "POST",
            path: "/users",
            body: T.Object({ name: T.String() }),
            response: T.Object({ id: T.String() }),
            errors: RouteErrors,
          },
          getUser: {
            method: "GET",
            path: "/users/:id",
            params: T.Object({ id: T.String() }),
            response: T.Object({ id: T.String() }),
          },
        },
        { globalErrors: GlobalErrors },
      );

      type Errors = ContractErrors<typeof contract>;

      // createUser gets union of global + route errors
      expectTypeOf<Static<Errors["createUser"]>>().toEqualTypeOf<
        { code: "NOT_FOUND" } | { code: "UNAUTHORIZED" } | { code: "CONFLICT" }
      >();

      // getUser gets only global errors (no route-specific errors)
      expectTypeOf<Static<NonNullable<Errors["getUser"]>>>().toEqualTypeOf<
        { code: "NOT_FOUND" } | { code: "UNAUTHORIZED" }
      >();
    });

    test("ContractErrors is undefined when no errors declared", () => {
      const contract = createContract({
        getUser: {
          method: "GET",
          path: "/users/:id",
          params: T.Object({ id: T.String() }),
          response: T.Object({ id: T.String() }),
        },
      });

      type Errors = ContractErrors<typeof contract>;
      expectTypeOf<Errors["getUser"]>().toEqualTypeOf<undefined>();
    });
  });
});
