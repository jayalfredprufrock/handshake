import { describe, expect, test } from "vite-plus/test";
import * as T from "typebox";
import type { OpenAPIV3_1 } from "openapi-types";
import { createApi, createContract } from "../contract";
import { DiscriminatedUnion } from "../typebox/discriminated-union";
import { generateOpenApi } from "./index";

const User = T.Object({ id: T.String(), name: T.String() }, { $id: "User" });

const contract = createContract(
  "/",
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

// The generator consumes an Api, not a bare Contract. Wrapping the contract under
// the api base path "/api" (group base path "/") keeps every emitted path at
// "/api/...", matching the original expectations.
const api = createApi("/api", { accounts: contract });

const spec = generateOpenApi(api, {
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
      // Mirrors the strictness `parseBody` enforces at runtime.
      additionalProperties: false,
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

  test("derives tags from the named groups of the api", () => {
    const out = generateOpenApi(api, { info: { title: "x", version: "1" } });
    expect(out.tags).toEqual([{ name: "accounts" }]);
    expect((Object.values(out.paths!["/api/users/{id}"]!)[0] as any).tags).toEqual(["accounts"]);
  });

  test("group name takes precedence over an endpoint's meta.tags", () => {
    // Behavior change: every api has named groups, so an operation's tag is always
    // its group name. The old "fall back to meta.tags when there is no named group"
    // path is unreachable now — the group name always wins. Here the group "system"
    // wins over the endpoint's own meta.tags of ["health"].
    const c = createApi("/", {
      system: createContract({
        ping: { method: "GET", path: "/ping", response: T.Null(), meta: { tags: ["health"] } },
      }),
    });
    const out = generateOpenApi(c, { info: { title: "x", version: "1" } });
    expect((out.paths!["/ping"]!.get! as any).tags).toEqual(["system"]);
  });

  test("omits internal endpoints", () => {
    const c = createApi("/api", {
      ops: createContract("/", {
        publicPing: { method: "GET", path: "/ping", response: T.Null() },
        secretPurge: { method: "DELETE", path: "/purge", response: T.Null(), internal: true },
      }),
    });
    const out = generateOpenApi(c, { info: { title: "x", version: "1" } });
    expect(out.paths).toHaveProperty(["/api/ping"]);
    expect(out.paths).not.toHaveProperty(["/api/purge"]);
  });
});

describe("generateOpenApi request body strictness", () => {
  const bodyOf = (out: OpenAPIV3_1.Document, path: string): any =>
    (out.paths?.[path] as any)?.post?.requestBody?.content["application/json"].schema;

  const specFor = (body: T.TSchema): OpenAPIV3_1.Document =>
    generateOpenApi(
      createApi("/api", {
        g: createContract("/", {
          write: { method: "POST", path: "/w", body, response: T.Object({ ok: T.Boolean() }) },
        }),
      }),
      { info: { title: "x", version: "1" } },
    );

  test("documents the additionalProperties: false the server enforces", () => {
    const out = specFor(T.Object({ name: T.String() }));
    expect(bodyOf(out, "/api/w").additionalProperties).toBe(false);
  });

  test("preserves an author's additionalProperties opt-out", () => {
    const out = specFor(T.Object({ name: T.String() }, { additionalProperties: true }));
    expect(bodyOf(out, "/api/w").additionalProperties).toBe(true);
  });

  test("documents closedness per union variant", () => {
    const out = specFor(
      T.Union([
        T.Object({ type: T.Literal("OPEN"), x: T.String() }, { additionalProperties: true }),
        T.Object({ type: T.Literal("CLOSED"), x: T.String() }),
      ]),
    );
    const variants = bodyOf(out, "/api/w").anyOf;
    expect(variants.map((v: any) => v.additionalProperties)).toEqual([true, false]);
  });

  test("closes nested objects and array items, not just the root", () => {
    const out = specFor(
      T.Object({
        n: T.Object({ a: T.String() }),
        items: T.Array(T.Object({ b: T.String() })),
      }),
    );
    const body = bodyOf(out, "/api/w");
    expect(body.additionalProperties).toBe(false);
    expect(body.properties.n.additionalProperties).toBe(false);
    expect(body.properties.items.items.additionalProperties).toBe(false);
  });

  test("documents responses as closed — Clean strips at every depth", () => {
    const out = specFor(T.Object({ name: T.String() }));
    const response = (out.paths!["/api/w"] as any).post.responses["200"].content["application/json"]
      .schema;
    expect(response.additionalProperties).toBe(false);
  });

  test("overrides a response's declared additionalProperties in the spec too", () => {
    // `parseResponse` force-closes, so an opt-out must not be advertised to clients.
    const out = generateOpenApi(
      createApi("/api", {
        g: createContract("/", {
          read: {
            method: "GET",
            path: "/r",
            response: T.Object({ a: T.String() }, { additionalProperties: true }),
          },
        }),
      }),
      { info: { title: "x", version: "1" } },
    );
    const response = (out.paths!["/api/r"] as any).get.responses["200"].content["application/json"]
      .schema;
    expect(response.additionalProperties).toBe(false);
  });

  test("shares a $id component when request and response close identically", () => {
    // Neither declares additionalProperties, so both modes yield `false` — the component
    // stays reusable and both operations may $ref it.
    const Shared = T.Object({ name: T.String() }, { $id: "Shared" });
    const out = generateOpenApi(
      createApi("/api", {
        g: createContract("/", {
          read: { method: "GET", path: "/r", response: Shared },
          write: {
            method: "POST",
            path: "/w",
            body: Shared,
            response: T.Object({ ok: T.Boolean() }),
          },
        }),
      }),
      { info: { title: "x", version: "1" } },
    );
    expect(out.components?.schemas?.Shared).toMatchObject({ additionalProperties: false });
    expect(bodyOf(out, "/api/w")).toEqual({ $ref: "#/components/schemas/Shared" });
  });

  test("inlines a $id schema whose closed form differs between request and response", () => {
    // A declared `true` is kept for the body but overridden for the response, so the two
    // cannot share one component — the diverging node sheds its `$id` and inlines.
    const Open = T.Object({ name: T.String() }, { $id: "Open", additionalProperties: true });
    const out = generateOpenApi(
      createApi("/api", {
        g: createContract("/", {
          read: { method: "GET", path: "/r", response: Open },
          write: {
            method: "POST",
            path: "/w",
            body: Open,
            response: T.Object({ ok: T.Boolean() }),
          },
        }),
      }),
      { info: { title: "x", version: "1" } },
    );
    const response = (out.paths!["/api/r"] as any).get.responses["200"].content["application/json"]
      .schema;
    expect(out.components?.schemas).not.toHaveProperty("Open");
    expect(bodyOf(out, "/api/w")).toMatchObject({ additionalProperties: true });
    expect(response).toMatchObject({ additionalProperties: false });
  });
});

describe("generateOpenApi discriminated unions", () => {
  const Cat = T.Object({ kind: T.Literal("cat"), meow: T.Boolean() }, { $id: "Cat" });
  const Dog = T.Object({ kind: T.Literal("dog"), bark: T.Number() }, { $id: "Dog" });
  const Fish = T.Object({ kind: T.Literal("fish") });

  function responseSchema(response: T.TSchema): Record<string, unknown> {
    const api = createApi("/", {
      pets: createContract("/", { getPet: { method: "GET", path: "/pet", response } }),
    });
    const spec = generateOpenApi(api, { info: { title: "t", version: "1" } });
    const res = spec.paths!["/pet"]!.get!.responses!["200"] as OpenAPIV3_1.ResponseObject;
    return res.content!["application/json"]!.schema as Record<string, unknown>;
  }

  test("emits oneOf with a mapping from each tag to its component", () => {
    expect(responseSchema(DiscriminatedUnion("kind", [Cat, Dog]))).toEqual({
      oneOf: [{ $ref: "#/components/schemas/Cat" }, { $ref: "#/components/schemas/Dog" }],
      discriminator: {
        propertyName: "kind",
        mapping: { cat: "#/components/schemas/Cat", dog: "#/components/schemas/Dog" },
      },
    });
  });

  test("maps variants from nested groups like a flat union", () => {
    expect(responseSchema(DiscriminatedUnion("kind", [T.Union([Cat, Dog])]))).toEqual(
      responseSchema(DiscriminatedUnion("kind", [Cat, Dog])),
    );
  });

  test("maps only $ref variants; inline ones stay in oneOf", () => {
    const schema = responseSchema(DiscriminatedUnion("kind", [Cat, Fish]));
    expect(schema.anyOf).toBeUndefined();
    expect(schema.oneOf).toHaveLength(2);
    expect(schema.discriminator).toEqual({
      propertyName: "kind",
      mapping: { cat: "#/components/schemas/Cat" },
    });
  });

  test("omits mapping when no variant is a component", () => {
    const Bird = T.Object({ kind: T.Literal("bird") });
    expect(responseSchema(DiscriminatedUnion("kind", [Fish, Bird])).discriminator).toEqual({
      propertyName: "kind",
    });
  });

  test("keeps a user-written mapping entry over the derived one", () => {
    const schema = responseSchema(
      T.Union([Cat, Dog], {
        discriminator: { propertyName: "kind", mapping: { cat: "#/components/schemas/Feline" } },
      }),
    );
    expect(schema.discriminator).toEqual({
      propertyName: "kind",
      mapping: { cat: "#/components/schemas/Feline", dog: "#/components/schemas/Dog" },
    });
  });

  test("leaves plain unions as anyOf", () => {
    const schema = responseSchema(T.Union([Cat, Dog]));
    expect(schema.anyOf).toHaveLength(2);
    expect(schema).not.toHaveProperty("discriminator");
  });
});
