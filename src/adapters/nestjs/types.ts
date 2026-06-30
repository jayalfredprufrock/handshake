import type { ArgumentsHost } from "@nestjs/common";
import type { Static, TSchema } from "typebox";
import type { ApiError, Contract, Endpoint, InferSchema } from "../../contract";
import type { BaseHandlerInput } from "../../server";

/** DI token for the resolved module options shared by the interceptor and filter. */
export const HANDSHAKE_OPTIONS = Symbol.for("handshake:nestjs:options");

type EndpointAt<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"],
> = C["endpoints"][K] extends Endpoint ? C["endpoints"][K] : never;

/**
 * The parsed, validated request input for an endpoint — the value injected by
 * `@HandshakeReq()`. Contains only the fields the endpoint declares.
 */
export type HandshakeInput<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"] & string,
> = BaseHandlerInput<EndpointAt<C, K>>;

/** The success response type an endpoint's handler must return. */
export type HandshakeResult<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"] & string,
> = InferSchema<EndpointAt<C, K>["response"]>;

/** Convenience accessor for an endpoint's parsed body type. */
export type HandshakeBody<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"] & string,
> = EndpointAt<C, K>["body"] extends TSchema ? Static<EndpointAt<C, K>["body"]> : never;

/** Convenience accessor for an endpoint's parsed path-params type. */
export type HandshakeParams<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"] & string,
> = EndpointAt<C, K>["params"] extends TSchema ? Static<EndpointAt<C, K>["params"]> : never;

/** Convenience accessor for an endpoint's parsed query type. */
export type HandshakeQuery<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"] & string,
> = EndpointAt<C, K>["query"] extends TSchema ? Static<EndpointAt<C, K>["query"]> : never;

/** Convenience accessor for an endpoint's parsed headers type. */
export type HandshakeHeaders<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"] & string,
> = EndpointAt<C, K>["headers"] extends TSchema ? Static<EndpointAt<C, K>["headers"]> : never;

/**
 * The allowed return type of a `@HandshakeHandler` method. Either the endpoint's
 * response value (validated/serialized) or a raw `Response` (passed through), sync
 * or async. The method decorator constrains the handler to this — so an invalid
 * return is a compile error without any manual annotation.
 */
export type HandshakeReturn<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"] & string,
> = HandshakeResult<C, K> | Response | Promise<HandshakeResult<C, K> | Response>;

/**
 * Map an unhandled error to a typed contract error. Receives the original error
 * and the Nest `ArgumentsHost`. Return an `ApiError` to shape the response, or
 * nothing for the default disposition (HttpException passthrough / UNKNOWN_ERROR).
 */
export type HandshakeErrorHandler = (
  err: unknown,
  host: ArgumentsHost,
) => ApiError | void | Promise<ApiError | void>;

/** Options for {@link HandshakeModule.forRoot}. */
export interface HandshakeModuleOptions {
  /** Default for response validation/stripping (per-handler `@HandshakeHandler` option wins). Default `true`. */
  validateResponse?: boolean;
  /** Maps non-contract errors to a response; mirrors the Hono adapter's `onError`. */
  onError?: HandshakeErrorHandler;
  /**
   * Contracts whose declared error codes should be recognized anywhere (including
   * errors thrown by guards/services). When omitted, only a route's own contract
   * codes (plus framework codes) are recognized; unrecognized `ApiError` codes
   * become `UNKNOWN_ERROR`.
   */
  contracts?: Contract<any, any, any>[];
}

/** Per-handler options passed to `@HandshakeHandler`. */
export interface HandshakeHandlerOptions {
  /** Override the module-level `validateResponse` for this endpoint. */
  validateResponse?: boolean;
}

/** Reflector metadata attached to a `@HandshakeHandler` method. */
export interface HandshakeMeta {
  contract: Contract<any, any, any>;
  endpointName: string;
  endpoint: Endpoint;
  options?: HandshakeHandlerOptions;
}

/** Internal resolved options provided under {@link HANDSHAKE_OPTIONS}. */
export interface ResolvedOptions {
  validateResponse?: boolean;
  onError?: HandshakeErrorHandler;
  /** Globally-recognized error codes, or `undefined` when no contracts were registered. */
  knownCodes?: Set<string>;
}
