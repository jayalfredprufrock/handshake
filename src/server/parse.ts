import type { TSchema } from "typebox";
import * as T from "typebox/value";
import type { ValidationIssue } from "../contract";

/**
 * Normalizes raw TypeBox assertion errors (`AssertError.cause.errors`) into the
 * stable, framework-owned `{ path?, keyword?, message }[]` shape carried by a
 * `VALIDATION_ERROR`'s `details` — so the wire contract doesn't leak TypeBox's
 * internal error format. `path` is the instance path in dot notation (no leading
 * slash), omitted at the root; `keyword` is the failed validation keyword.
 */
export function normalizeIssues(raw: unknown): ValidationIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): ValidationIssue[] => {
    const issue = entry as {
      instancePath?: unknown;
      keyword?: unknown;
      message?: unknown;
      params?: unknown;
    };
    const message = typeof issue.message === "string" ? issue.message : "Invalid value";
    const basePath =
      typeof issue.instancePath === "string" && issue.instancePath !== ""
        ? issue.instancePath.replace(/^\//, "").replace(/\//g, ".")
        : undefined;
    const keyword = typeof issue.keyword === "string" ? issue.keyword : undefined;

    // `additionalProperties` errors report the offending keys in `params` and
    // anchor `instancePath` at the parent object (root → empty). Expand them into
    // one issue per rejected property so the client learns each field by name.
    if (keyword === "additionalProperties") {
      const extras = (issue.params as { additionalProperties?: unknown } | undefined)
        ?.additionalProperties;
      const keys = Array.isArray(extras)
        ? extras.filter((k): k is string => typeof k === "string")
        : [];
      if (keys.length > 0) {
        return keys.map((key) => ({
          path: basePath ? `${basePath}.${key}` : key,
          keyword,
          message,
        }));
      }
    }

    const result: ValidationIssue = { message };
    if (basePath !== undefined) result.path = basePath;
    if (keyword !== undefined) result.keyword = keyword;
    return [result];
  });
}

function assertAndReturn(_context: object, type: TSchema, value: unknown): unknown {
  T.Assert(type, value);
  return value;
}

const paramsPipeline = T.Pipeline([
  (_context, type, value) => T.Default(type, value),
  (_context, type, value) => T.Convert(type, value),
  assertAndReturn,
]);

const queryPipeline = T.Pipeline([
  (_context, type, value) => T.Default(type, value),
  (_context, type, value) => T.Convert(type, value),
  assertAndReturn,
]);

export class QueryNormalizationError extends Error {}

/**
 * Normalizes raw query values from a `Record<string, string[]>` (e.g. from Hono's
 * `c.req.queries()` or Express's `req.query` when configured for arrays) against
 * the query schema. Array schema properties keep their arrays; scalar schema
 * properties unwrap single-element arrays or throw if multiple values.
 */
function normalizeQueryValues(
  schema: TSchema,
  raw: Record<string, string[]>,
): Record<string, unknown> {
  const properties =
    (schema as { properties?: Record<string, { type?: string }> }).properties ?? {};
  const result: Record<string, unknown> = {};

  for (const [key, values] of Object.entries(raw)) {
    const propSchema = properties[key];
    if (propSchema?.type === "array") {
      result[key] = values;
    } else if (values.length > 1) {
      throw new QueryNormalizationError(
        `Query parameter "${key}" received ${values.length} values but schema expects a scalar`,
      );
    } else {
      result[key] = values[0];
    }
  }

  return result;
}

/**
 * Parses and validates path parameters against a schema.
 * Coerces string values to the types specified by the schema.
 */
export function parseParams(schema: TSchema, raw: Record<string, string>): unknown {
  return paramsPipeline(schema, raw);
}

/**
 * Parses and validates query parameters against a schema.
 * Handles array normalization (repeated keys → arrays for array schemas,
 * single values for scalar schemas) and coerces string values.
 */
export function parseQuery(schema: TSchema, raw: Record<string, string[]>): unknown {
  const normalized = normalizeQueryValues(schema, raw);
  return queryPipeline(schema, normalized);
}

/**
 * Parses and validates request headers against a schema. Coerces string values and
 * ignores headers not named in the schema (a request always carries many).
 */
export function parseHeaders(schema: TSchema, raw: Record<string, string>): unknown {
  return paramsPipeline(schema, raw);
}

/**
 * Parses and validates a request body against a schema.
 * Rejects missing or extra properties. No coercion is performed.
 */
export function parseBody(schema: TSchema, raw: unknown): unknown {
  const value = T.Default(schema, raw);
  T.Assert({ ...schema, additionalProperties: false } as TSchema, value);
  return value;
}

/**
 * Thrown when a handler's response doesn't match its schema. This is a server bug, so the
 * adapter surfaces it as an `UNKNOWN_ERROR` to the client — but `onError` can detect this
 * type to log or alert on the underlying `issues`.
 */
export class ResponseValidationError extends Error {
  constructor(readonly issues: unknown) {
    super("Response validation failed");
    this.name = "ResponseValidationError";
  }
}

/**
 * Validates a handler response against a schema. Strips unknown properties, then throws a
 * {@link ResponseValidationError} if the known properties don't match.
 */
export function parseResponse(schema: TSchema, raw: unknown): unknown {
  const value = T.Clean(schema, raw);
  try {
    T.Assert(schema, value);
  } catch (err) {
    if (err instanceof T.AssertError) {
      throw new ResponseValidationError(err.cause.errors);
    }
    throw err;
  }
  return value;
}

export function checkValue(schema: TSchema, value: unknown): boolean {
  return T.Check(schema, value);
}

const AssertError = T.AssertError;

export { AssertError };
