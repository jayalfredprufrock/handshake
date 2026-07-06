import type { OpenAPIV3_1 } from "openapi-types";
import type { Api, Endpoint, ErrorMap } from "../contract";
import { HANDSHAKE_ERROR_KIND, joinPath } from "../contract";
import { SchemaRegistry } from "./schema";
import type { Schema } from "./schema";

type SchemaObject = OpenAPIV3_1.SchemaObject;
type ReferenceObject = OpenAPIV3_1.ReferenceObject;

export interface GenerateOpenApiOptions {
  /** OpenAPI `info` object (`title` and `version` are required by the spec). */
  info: OpenAPIV3_1.InfoObject;
  servers?: OpenAPIV3_1.ServerObject[];
  security?: OpenAPIV3_1.SecurityRequirementObject[];
  /** Top-level tags; defaults to one per named group of a combined contract. */
  tags?: OpenAPIV3_1.TagObject[];
}

/** Standard reason phrases for the response `description` (required by OpenAPI). */
const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

const VALIDATION_ISSUE_SCHEMA: SchemaObject = {
  type: "object",
  properties: {
    path: { type: "string" },
    keyword: { type: "string" },
    message: { type: "string" },
  },
  required: ["message"],
  additionalProperties: false,
};

/** Builds the `{ kind, code, status, message, details? }` envelope schema for one error code. */
function errorEnvelopeSchema(
  code: string,
  status: number,
  details: Schema | undefined,
  detailsRequired: boolean,
): SchemaObject {
  const properties: Record<string, Schema> = {
    kind: { type: "string", const: HANDSHAKE_ERROR_KIND },
    code: { type: "string", const: code },
    status: { type: "integer", const: status },
    message: { type: "string" },
  };
  const required = ["kind", "code", "status", "message"];
  if (details) {
    properties.details = details;
    if (detailsRequired) required.push("details");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

interface ErrorEntry {
  code: string;
  status: number;
  details?: Schema;
  detailsRequired: boolean;
}

/**
 * Registers every error (the framework `VALIDATION_ERROR`/`UNKNOWN_ERROR` plus the
 * contract's declared errors) as a named schema, and a shared response per status
 * (a `oneOf` discriminated by `code` when several codes share a status).
 */
function buildErrorResponses(
  errors: ErrorMap | undefined,
  registry: SchemaRegistry,
): {
  responses: Record<string, OpenAPIV3_1.ResponseObject>;
  refsByStatus: Record<string, ReferenceObject>;
} {
  const issues = registry.register("ValidationIssue", VALIDATION_ISSUE_SCHEMA);

  const entries: ErrorEntry[] = [
    {
      code: "VALIDATION_ERROR",
      status: 400,
      details: { type: "array", items: issues },
      detailsRequired: false,
    },
    { code: "UNKNOWN_ERROR", status: 500, detailsRequired: false },
  ];
  for (const [code, def] of Object.entries(errors ?? {})) {
    entries.push({
      code,
      status: def.status,
      details: def.details ? registry.convert(def.details) : undefined,
      detailsRequired: Boolean(def.details),
    });
  }

  const refByCode = new Map<string, ReferenceObject>();
  for (const entry of entries) {
    refByCode.set(
      entry.code,
      registry.register(
        entry.code,
        errorEnvelopeSchema(entry.code, entry.status, entry.details, entry.detailsRequired),
      ),
    );
  }

  const codesByStatus = new Map<number, string[]>();
  for (const entry of entries) {
    const list = codesByStatus.get(entry.status) ?? [];
    list.push(entry.code);
    codesByStatus.set(entry.status, list);
  }

  const responses: Record<string, OpenAPIV3_1.ResponseObject> = {};
  const refsByStatus: Record<string, ReferenceObject> = {};
  for (const [status, codes] of codesByStatus) {
    const refs = codes.map((code) => refByCode.get(code)!);
    const schema: Schema =
      refs.length === 1
        ? refs[0]!
        : ({
            oneOf: refs,
            discriminator: {
              propertyName: "code",
              mapping: Object.fromEntries(codes.map((code) => [code, refByCode.get(code)!.$ref])),
            },
          } as SchemaObject);
    const name = `Error${status}`;
    responses[name] = {
      description: STATUS_TEXT[status] ?? "Error",
      content: { "application/json": { schema } },
    };
    refsByStatus[String(status)] = { $ref: `#/components/responses/${name}` };
  }
  return { responses, refsByStatus };
}

/** Converts `:param` path syntax to OpenAPI `{param}` syntax. */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

/** Decomposes a params/query/headers object schema into individual OpenAPI parameters. */
function decomposeParameters(
  schema: Endpoint["params"],
  location: "path" | "query" | "header",
  registry: SchemaRegistry,
): OpenAPIV3_1.ParameterObject[] {
  if (!schema) return [];
  const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
  const required = new Set((schema as { required?: string[] }).required ?? []);
  return Object.entries(properties).map(
    ([name, propSchema]): OpenAPIV3_1.ParameterObject => ({
      name,
      in: location,
      required: location === "path" ? true : required.has(name),
      // openapi-types reuses the V3 SchemaObject for 3.1 parameters; our schema is valid 3.1.
      schema: registry.convert(propSchema as never) as OpenAPIV3_1.ParameterObject["schema"],
    }),
  );
}

/** Maps an endpoint's `meta` (minus `tags`) to `x-*` specification extensions. */
function metaExtensions(meta: unknown): Record<string, unknown> {
  if (typeof meta !== "object" || meta === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (key === "tags") continue;
    out[`x-${key}`] = value;
  }
  return out;
}

function buildTagIndex(api: Api<any, any>): {
  topTags: OpenAPIV3_1.TagObject[];
  tagFor: (endpointName: string) => string | undefined;
} {
  const groups = api.contracts as Record<string, { endpoints?: Record<string, unknown> }>;
  const endpointToGroup = new Map<string, string>();
  for (const [group, sub] of Object.entries(groups)) {
    for (const endpointName of Object.keys(sub.endpoints ?? {})) {
      endpointToGroup.set(endpointName, group);
    }
  }
  return {
    topTags: Object.keys(groups).map((name) => ({ name })),
    tagFor: (endpointName) => endpointToGroup.get(endpointName),
  };
}

function buildOperation(
  name: string,
  endpoint: Endpoint,
  registry: SchemaRegistry,
  errorRefs: Record<string, ReferenceObject>,
  tagFor: (endpointName: string) => string | undefined,
): OpenAPIV3_1.OperationObject {
  const parameters = [
    ...decomposeParameters(endpoint.params, "path", registry),
    ...decomposeParameters(endpoint.query, "query", registry),
    ...decomposeParameters(endpoint.headers, "header", registry),
  ];

  const group = tagFor(name);
  const metaTags = (endpoint.meta as { tags?: unknown } | undefined)?.tags;
  const tags = group ? [group] : Array.isArray(metaTags) ? (metaTags as string[]) : undefined;

  const responses: Record<string, OpenAPIV3_1.ResponseObject | ReferenceObject> = {
    [String(endpoint.responseCode ?? 200)]: {
      description: "Successful response",
      content: { "application/json": { schema: registry.convert(endpoint.response) } },
    },
    ...errorRefs,
  };

  return {
    operationId: name,
    ...(endpoint.description ? { description: endpoint.description } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(endpoint.body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: registry.convert(endpoint.body) } },
          },
        }
      : {}),
    responses,
    ...metaExtensions(endpoint.meta),
  };
}

/**
 * Generates an OpenAPI 3.1 document from a handshake contract. Reusable schemas
 * (those declaring a TypeBox `$id`) and all error envelopes are emitted to
 * `components`; every operation documents the contract's full error set.
 */
export function generateOpenApi(
  api: Api<any, any>,
  options: GenerateOpenApiOptions,
): OpenAPIV3_1.Document {
  const registry = new SchemaRegistry();
  const { responses, refsByStatus } = buildErrorResponses(api.errors, registry);
  const { topTags, tagFor } = buildTagIndex(api);

  const paths: Record<string, OpenAPIV3_1.PathItemObject> = {};
  for (const [name, endpoint] of Object.entries(api.endpoints as Record<string, Endpoint>)) {
    if (endpoint.internal) continue;
    const path = toOpenApiPath(joinPath(api.basePath, endpoint.path));
    const item = (paths[path] ??= {});
    const method = endpoint.method.toLowerCase() as Lowercase<Endpoint["method"]>;
    (item as Record<string, OpenAPIV3_1.OperationObject>)[method] = buildOperation(
      name,
      endpoint,
      registry,
      refsByStatus,
      tagFor,
    );
  }

  const tags = options.tags ?? (topTags.length > 0 ? topTags : undefined);

  return {
    openapi: "3.1.0",
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    ...(options.security ? { security: options.security } : {}),
    ...(tags ? { tags } : {}),
    paths,
    components: {
      schemas: registry.schemas,
      responses,
    },
  };
}
