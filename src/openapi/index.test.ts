import { describe, expect, test } from "vite-plus/test";
import * as T from "typebox";
import { combineContracts, createContract } from "../contract";
import { generateOpenApi } from "./index";

const User = T.Object({ id: T.String(), name: T.String() }, { $id: "User" });

const contract = createContract(
  "/api",
  {
    getUser: {
      method: "GET",
      path: "/users/:id",
      params: T.Object({ id: T.String() }),
      query: T.Object({ verbose: T.Optional(T.Boolean()) }),
      headers: T.Object({ "x-api-key": T.String() }),
      response: User,
      description: "Fetch a user",
      meta: { auth: "required" },
    },
    createUser: {
      method: "POST",
      path: "/users",
      body: T.Object({ name: T.String() }),
      response: User,
      responseCode: 201,
    },
  },
  {
    errors: {
      NOT_FOUND: { status: 404 },
      CONFLICT: { status: 409, details: T.Object({ conflictingId: T.String() }) },
      RATE_LIMIT: { status: 400 }, // shares 400 with the framework VALIDATION_ERROR
    },
  },
);

const spec = generateOpenApi(contract, {
  info: { title: "Demo", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
});

describe("generateOpenApi", () => {
  test("emits a 3.1 document with info and servers", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info).toEqual({ title: "Demo", version: "1.0.0" });
    expect(spec.servers).toEqual([{ url: "https://api.example.com" }]);
  });

  test("converts :param paths and prefixes the base path", () => {
    expect(spec.paths).toHaveProperty(["/api/users/{id}"]);
    expect(spec.paths).toHaveProperty(["/api/users"]);
    expect(spec.paths!["/api/users/{id}"]!.get?.operationId).toBe("getUser");
    expect(spec.paths!["/api/users"]!.post?.operationId).toBe("createUser");
  });

  test("decomposes params/query/headers with correct `required`", () => {
    const params = spec.paths!["/api/users/{id}"]!.get!.parameters as any[];
    expect(params).toContainEqual({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string" },
    });
    expect(params).toContainEqual({
      name: "verbose",
      in: "query",
      required: false,
      schema: { type: "boolean" },
    });
    expect(params).toContainEqual({
      name: "x-api-key",
      in: "header",
      required: true,
      schema: { type: "string" },
    });
  });

  test("emits a requestBody for endpoints with a body", () => {
    const post = spec.paths!["/api/users"]!.post! as any;
    expect(post.requestBody.required).toBe(true);
    expect(post.requestBody.content["application/json"].schema).toEqual({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    });
  });

  test("uses responseCode for the success status and $ref for $id schemas", () => {
    const get = spec.paths!["/api/users/{id}"]!.get! as any;
    const post = spec.paths!["/api/users"]!.post! as any;
    expect(get.responses["200"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/User",
    });
    expect(post.responses["201"]).toBeDefined();
  });

  test("documents the full error set on every operation as shared responses", () => {
    for (const path of ["/api/users/{id}", "/api/users"]) {
      const op = Object.values(spec.paths![path]!)[0] as any;
      expect(op.responses["400"]).toEqual({ $ref: "#/components/responses/Error400" });
      expect(op.responses["404"]).toEqual({ $ref: "#/components/responses/Error404" });
      expect(op.responses["409"]).toEqual({ $ref: "#/components/responses/Error409" });
      expect(op.responses["500"]).toEqual({ $ref: "#/components/responses/Error500" });
    }
  });

  test("uses oneOf with a discriminator when codes share a status", () => {
    const schema = (spec.components!.responses!.Error400 as any).content["application/json"].schema;
    expect(schema.oneOf).toEqual([
      { $ref: "#/components/schemas/VALIDATION_ERROR" },
      { $ref: "#/components/schemas/RATE_LIMIT" },
    ]);
    expect(schema.discriminator.propertyName).toBe("code");
    expect(schema.discriminator.mapping).toEqual({
      VALIDATION_ERROR: "#/components/schemas/VALIDATION_ERROR",
      RATE_LIMIT: "#/components/schemas/RATE_LIMIT",
    });
  });

  test("registers framework + declared error envelopes as named schemas", () => {
    const schemas = spec.components!.schemas! as any;
    expect(schemas.VALIDATION_ERROR.properties.code).toEqual({
      type: "string",
      const: "VALIDATION_ERROR",
    });
    expect(schemas.VALIDATION_ERROR.properties.details).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/ValidationIssue" },
    });
    expect(schemas.UNKNOWN_ERROR.properties.status).toEqual({ type: "integer", const: 500 });
    // CONFLICT carries a required details payload
    expect(schemas.CONFLICT.required).toContain("details");
    expect(schemas.CONFLICT.properties.details.properties.conflictingId).toEqual({
      type: "string",
    });
    // NOT_FOUND has no details
    expect(schemas.NOT_FOUND.properties).not.toHaveProperty("details");
    expect(schemas.ValidationIssue.required).toEqual(["message"]);
  });

  test("maps meta to x-* extensions", () => {
    expect((spec.paths!["/api/users/{id}"]!.get! as any)["x-auth"]).toBe("required");
  });

  test("derives tags from named groups of a combined contract", () => {
    const combined = combineContracts({ accounts: contract });
    const out = generateOpenApi(combined, { info: { title: "x", version: "1" } });
    expect(out.tags).toEqual([{ name: "accounts" }]);
    expect((Object.values(out.paths!["/api/users/{id}"]!)[0] as any).tags).toEqual(["accounts"]);
  });

  test("falls back to meta.tags when there is no named group", () => {
    const c = createContract({
      ping: { method: "GET", path: "/ping", response: T.Null(), meta: { tags: ["health"] } },
    });
    const out = generateOpenApi(c, { info: { title: "x", version: "1" } });
    expect((out.paths!["/ping"]!.get! as any).tags).toEqual(["health"]);
  });
});
