import type { TSchema } from "typebox";
import * as T from "typebox";

export type ApiErrorBody = { readonly code: string };

export class ApiError<B extends ApiErrorBody = ApiErrorBody> extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: B,
  ) {
    super(body.code);
    this.name = "ApiError";
  }
}

export function isApiError(err: unknown): err is ApiError;
export function isApiError<C extends string>(
  err: unknown,
  code: C,
): err is ApiError<{ code: C } & Record<string, unknown>>;
export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.body.code === code);
}

export function computeEffectiveErrors(
  globalErrors: TSchema | undefined,
  routeErrors: TSchema | undefined,
): TSchema | undefined {
  if (globalErrors && routeErrors) return T.Union([globalErrors, routeErrors]);
  return globalErrors ?? routeErrors;
}
