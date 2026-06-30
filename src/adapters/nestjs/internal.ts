import type { ValidationIssue } from "../../contract";
import { ApiError } from "../../contract";
import { AssertError, QueryNormalizationError, normalizeIssues } from "../../server";

/**
 * Carries a handler-returned raw `Response` out of the interceptor to the
 * exception filter, which owns the platform response and can write an arbitrary
 * status/body. Thrown (not returned) so it bypasses Nest's own serialization.
 */
export class RawResponseException {
  constructor(readonly response: Response) {}
}

/** Builds the framework `VALIDATION_ERROR` (400) thrown on a request parse failure. */
export function validationError(issues: ValidationIssue[]): ApiError {
  return new ApiError({
    code: "VALIDATION_ERROR",
    status: 400,
    message: "Validation failed",
    details: issues,
  });
}

/**
 * Runs a request-parse step, converting TypeBox assertion / query-normalization
 * failures into a `VALIDATION_ERROR`. Mirrors the Hono adapter's per-field catch.
 */
export function guardValidation<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof AssertError) throw validationError(normalizeIssues(err.cause.errors));
    if (err instanceof QueryNormalizationError) throw validationError([{ message: err.message }]);
    throw err;
  }
}

/**
 * Extracts query values from a request URL into the `Record<string, string[]>`
 * shape `parseQuery` expects. Reading from the URL (rather than a platform's
 * pre-parsed `req.query`) keeps semantics identical across Express/Fastify and
 * matches the Hono adapter's repeated-key handling.
 */
export function readQuery(url: unknown): Record<string, string[]> {
  const str = typeof url === "string" ? url : "";
  const qIndex = str.indexOf("?");
  const params = new URLSearchParams(qIndex >= 0 ? str.slice(qIndex) : "");
  const out: Record<string, string[]> = {};
  for (const key of params.keys()) {
    if (!(key in out)) out[key] = params.getAll(key);
  }
  return out;
}

/** Normalizes a platform headers object to `Record<string, string>` for `parseHeaders`. */
export function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
      else if (Array.isArray(value)) out[key] = value.join(", ");
    }
  }
  return out;
}
