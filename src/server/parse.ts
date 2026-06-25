import type { TSchema } from "typebox";
import * as T from "typebox/value";

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
