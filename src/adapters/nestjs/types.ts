import type { ArgumentsHost } from "@nestjs/common";
import type { Api, ApiError, Endpoint, InferSchema } from "../../contract";

/** DI token for the resolved module options shared by the interceptor and filter. */
export const HANDSHAKE_OPTIONS = Symbol.for("handshake:nestjs:options");

/** The success response type an endpoint's handler must return. */
export type ApiResult<
  A extends Api<any, any>,
  Name extends keyof A["endpoints"] & string,
> = InferSchema<A["endpoints"][Name]["response"]>;

/**
 * The allowed return type of an `@ApiHandler` method: the endpoint's response value
 * (validated/serialized) or a raw `Response` (passed through), sync or async.
 */
export type ApiReturn<A extends Api<any, any>, Name extends keyof A["endpoints"] & string> =
  | ApiResult<A, Name>
  | Response
  | Promise<ApiResult<A, Name> | Response>;

/**
 * Maps an unhandled error to a typed contract error. Receives the original error
 * and the Nest `ArgumentsHost`. Return an `ApiError` to shape the response, or
 * nothing for the default disposition (HttpException passthrough / UNKNOWN_ERROR).
 */
export type HandshakeErrorHandler = (
  err: unknown,
  host: ArgumentsHost,
) => ApiError | void | Promise<ApiError | void>;

/** Options for {@link HandshakeModule.forRoot}. */
export interface HandshakeModuleOptions {
  /** Default for response validation/stripping (per-handler `@ApiHandler` option wins). Default `true`. */
  validateResponse?: boolean;
  /** Maps non-contract errors to a response; mirrors the Hono adapter's `onError`. */
  onError?: HandshakeErrorHandler;
  /**
   * The api(s) this app serves. Their declared error codes are recognized anywhere
   * (guards, services), and — at bootstrap — every api endpoint is asserted to have
   * a bound `@ApiHandler`, with no duplicate or conflicting routes.
   */
  apis?: Api<any, any> | Api<any, any>[];
}

/** Per-handler options passed to `@ApiHandler`. */
export interface ApiHandlerOptions {
  /** Override the module-level `validateResponse` for this endpoint. */
  validateResponse?: boolean;
}

/** Reflector metadata attached to an `@ApiHandler` method. */
export interface HandshakeMeta {
  api: Api<any, any>;
  endpointName: string;
  endpoint: Endpoint;
  options?: ApiHandlerOptions;
}

/** Internal resolved options provided under {@link HANDSHAKE_OPTIONS}. */
export interface ResolvedOptions {
  validateResponse?: boolean;
  onError?: HandshakeErrorHandler;
  /** Globally-recognized error codes, or `undefined` when no apis were registered. */
  knownCodes?: Set<string>;
  /** The registered apis, for the bootstrap completeness/conflict scan. */
  apis?: Api<any, any>[];
}
