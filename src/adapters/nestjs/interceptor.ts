import { Inject, Injectable } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Observable } from "rxjs";
import { map } from "rxjs";
import type { TSchema } from "typebox";
import { parseBody, parseHeaders, parseParams, parseQuery, parseResponse } from "../../server";
import { HANDSHAKE_INPUT, HANDSHAKE_META, HANDSHAKE_REQ_META } from "./decorators";
import { RawResponseException, guardValidation, normalizeHeaders, readQuery } from "./internal";
import { HANDSHAKE_OPTIONS } from "./types";
import type { HandshakeMeta, ResolvedOptions } from "./types";

/**
 * Parses + validates the request before the handler (stashing the result for
 * `@HandshakeReq()`), then validates/strips the handler's response. A raw
 * `Response` return is thrown to the filter for passthrough. Routes without
 * `@HandshakeHandler` metadata pass through untouched.
 */
@Injectable()
export class HandshakeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(HANDSHAKE_OPTIONS) private readonly options: ResolvedOptions,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<HandshakeMeta | undefined>(
      HANDSHAKE_META,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const { endpoint } = meta;
    const req = context.switchToHttp().getRequest<Record<PropertyKey, any>>();

    const input: Record<string, unknown> = {};
    if (endpoint.params) {
      input.params = guardValidation(() =>
        parseParams(endpoint.params as TSchema, (req.params as Record<string, string>) ?? {}),
      );
    }
    if (endpoint.query) {
      input.query = guardValidation(() =>
        parseQuery(endpoint.query as TSchema, readQuery(req.url)),
      );
    }
    if (endpoint.headers) {
      input.headers = guardValidation(() =>
        parseHeaders(endpoint.headers as TSchema, normalizeHeaders(req.headers)),
      );
    }
    if (endpoint.body) {
      input.body = guardValidation(() => parseBody(endpoint.body as TSchema, req.body));
    }

    req[HANDSHAKE_INPUT] = input;
    req[HANDSHAKE_REQ_META] = meta;

    const shouldValidate = meta.options?.validateResponse ?? this.options.validateResponse ?? true;

    return next.handle().pipe(
      map((result) => {
        if (result instanceof Response) throw new RawResponseException(result);
        if (shouldValidate && endpoint.response) return parseResponse(endpoint.response, result);
        return result;
      }),
    );
  }
}
