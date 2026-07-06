import {
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  SetMetadata,
  applyDecorators,
  createParamDecorator,
} from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Api, Endpoint } from "../../contract";
import { joinPath } from "../../contract";
import type { BaseHandlerInput } from "../../server";
import type { ApiHandlerOptions, ApiReturn, HandshakeMeta } from "./types";

/** Reflector metadata key carrying the {@link HandshakeMeta} for a route. */
export const HANDSHAKE_META = "handshake:meta";
/** Request property where the interceptor stashes the parsed input for `@ApiInput()`. */
export const HANDSHAKE_INPUT = Symbol.for("handshake:nestjs:input");
/**
 * Request property where the interceptor stashes the route {@link HandshakeMeta}.
 * Available to any consumer that runs after the interceptor (e.g. an exception
 * filter). In a guard or interceptor, prefer reading {@link HANDSHAKE_META} off the
 * handler via `Reflector` — middleware runs before the interceptor, so it is not set there.
 */
export const HANDSHAKE_REQ_META = Symbol.for("handshake:nestjs:req-meta");

const VERB = { GET: Get, POST: Post, PATCH: Patch, DELETE: Delete } as const;

/**
 * Binds a controller method to an api endpoint (unique across the api). Registers
 * the route (verb + `joinPath(api.basePath, endpoint.path)`), forces the success
 * status to `endpoint.responseCode ?? 200` (overriding Nest's POST→201 default),
 * and stamps the metadata the interceptor/filter read.
 *
 * The returned decorator is generically typed to **enforce the handler's return
 * type** against the endpoint's response schema — a non-conforming return is a
 * compile error, with no manual annotation required.
 */
export function ApiHandler<A extends Api<any, any>, Name extends keyof A["endpoints"] & string>(
  api: A,
  endpointName: Name,
  options?: ApiHandlerOptions,
) {
  const endpoint = api.endpoints[endpointName] as Endpoint;
  const fullPath = joinPath(api.basePath, endpoint.path);
  const verb = VERB[endpoint.method];
  const meta: HandshakeMeta = { api, endpointName, endpoint, options };

  const decorate = applyDecorators(
    verb(fullPath),
    HttpCode(endpoint.responseCode ?? 200),
    SetMetadata(HANDSHAKE_META, meta),
  );

  return <T extends (...args: any[]) => ApiReturn<A, Name>>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): void => {
    decorate(target, propertyKey, descriptor as TypedPropertyDescriptor<any>);
  };
}

/**
 * Injects the parsed, validated request input for the endpoint. The interceptor
 * parses and stashes it before the handler runs. Also usable as a type:
 * `@ApiInput() input: ApiInput<typeof api, "listJobs">`.
 */
export const ApiInput = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Record<PropertyKey, unknown>>();
  return req[HANDSHAKE_INPUT];
});

/** The parsed, validated input type for an endpoint (see {@link ApiInput}). */
export type ApiInput<
  A extends Api<any, any>,
  Name extends keyof A["endpoints"] & string,
> = BaseHandlerInput<A["endpoints"][Name]>;
