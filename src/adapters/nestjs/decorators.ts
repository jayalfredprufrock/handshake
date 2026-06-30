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
import type { Contract, Endpoint } from "../../contract";
import { joinPath } from "../../contract";
import type { HandshakeHandlerOptions, HandshakeMeta, HandshakeReturn } from "./types";

/** Reflector metadata key carrying the {@link HandshakeMeta} for a route. */
export const HANDSHAKE_META = "handshake:meta";
/** Request property where the interceptor stashes the parsed input for `@HandshakeReq()`. */
export const HANDSHAKE_INPUT = Symbol.for("handshake:nestjs:input");
/** Request property where the interceptor stashes the route meta for the filter. */
export const HANDSHAKE_REQ_META = Symbol.for("handshake:nestjs:req-meta");

const VERB = { GET: Get, POST: Post, PATCH: Patch, DELETE: Delete } as const;

/**
 * Binds a controller method to a contract endpoint. Registers the route (verb +
 * `joinPath(contract.basePath, endpoint.path)`), forces the success status to
 * `endpoint.responseCode ?? 200` (overriding Nest's POST→201 default), and stamps
 * the metadata the interceptor/filter read.
 *
 * The returned decorator is generically typed to **enforce the handler's return
 * type** against the endpoint's response schema — returning a non-conforming value
 * is a compile error, with no manual annotation required.
 */
export function HandshakeHandler<
  C extends Contract<any, any, any>,
  K extends keyof C["endpoints"] & string,
>(contract: C, endpointName: K, options?: HandshakeHandlerOptions) {
  const endpoint = contract.endpoints[endpointName] as Endpoint;
  const fullPath = joinPath(contract.basePath, endpoint.path);
  const verb = VERB[endpoint.method];
  const meta: HandshakeMeta = { contract, endpointName, endpoint, options };

  const decorate = applyDecorators(
    verb(fullPath),
    HttpCode(endpoint.responseCode ?? 200),
    SetMetadata(HANDSHAKE_META, meta),
  );

  return <T extends (...args: any[]) => HandshakeReturn<C, K>>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): void => {
    decorate(target, propertyKey, descriptor as TypedPropertyDescriptor<any>);
  };
}

/**
 * Injects the parsed, validated request input ({@link HandshakeInput}) for the
 * endpoint. The interceptor parses and stashes it before the handler runs.
 */
export const HandshakeReq = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Record<PropertyKey, unknown>>();
  return req[HANDSHAKE_INPUT];
});
