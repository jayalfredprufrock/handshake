import type { TSchema } from "typebox";
import { Assert, AssertError, Clean, Convert, Default, Pipeline } from "typebox/value";

function assertAndReturn(_context: object, type: TSchema, value: unknown): unknown {
  Assert(type, value);
  return value;
}

const paramsPipeline = Pipeline([
  (_context, type, value) => Default(type, value),
  (_context, type, value) => Convert(type, value),
  assertAndReturn,
]);

const queryPipeline = Pipeline([
  (_context, type, value) => Default(type, value),
  (_context, type, value) => Convert(type, value),
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
 * Parses and validates a request body against a schema.
 * Rejects missing or extra properties. No coercion is performed.
 */
export function parseBody(schema: TSchema, raw: unknown): unknown {
  const value = Default(schema, raw);
  Assert({ ...schema, additionalProperties: false } as TSchema, value);
  return value;
}

/**
 * Validates a handler response against a schema.
 * Strips unknown properties without throwing, but throws if known properties
 * don't match the expected types.
 */
export function parseResponse(schema: TSchema, raw: unknown): unknown {
  const value = Clean(schema, raw);
  Assert(schema, value);
  return value;
}

export { AssertError };
