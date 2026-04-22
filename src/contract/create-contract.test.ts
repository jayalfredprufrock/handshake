import { describe, expect, test } from "vite-plus/test";
import { Type } from "typebox";
import { createContract } from "./create-contract";

describe("createContract", () => {
  test("creates contract with default basePath", () => {
    const contract = createContract({
      getUser: {
        method: "GET",
        path: "/users/:id",
        params: Type.Object({ id: Type.String() }),
        response: Type.Object({ id: Type.String(), name: Type.String() }),
      },
    });

    expect(contract.basePath).toBe("/");
    expect(contract.endpoints.getUser.method).toBe("GET");
    expect(contract.endpoints.getUser.path).toBe("/users/:id");
  });

  test("creates contract with explicit basePath", () => {
    const contract = createContract("/api/v1", {
      listUsers: {
        method: "GET",
        path: "/users",
        response: Type.Array(Type.Object({ id: Type.String() })),
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
        body: Type.Object({ name: Type.String() }),
        response: Type.Object({ id: Type.String(), name: Type.String() }),
        description: "Create a user",
        meta: { auth: true },
      },
    });

    const endpoint = contract.endpoints.createUser;
    expect(endpoint.description).toBe("Create a user");
    expect(endpoint.meta).toEqual({ auth: true });
    expect(endpoint.body).toBeDefined();
  });
});
