import { Catch, HttpException, Inject } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { AbstractHttpAdapter } from "@nestjs/core";
import { ApiError, RESERVED_ERROR_CODES, errorEnvelope } from "../../contract";
import { HANDSHAKE_REQ_META } from "./decorators";
import { RawResponseException } from "./internal";
import { HANDSHAKE_OPTIONS } from "./types";
import type { HandshakeMeta, ResolvedOptions } from "./types";

/**
 * Serializes every error the app emits into the handshake wire envelope, mirroring
 * the Hono adapter's `root.onError`:
 *
 * 1. A handler-returned raw `Response` ({@link RawResponseException}) is written through.
 * 2. A **known-code** `ApiError` (a code declared by a registered/route contract, or a
 *    framework `VALIDATION_ERROR`/`UNKNOWN_ERROR`) is serialized as-is, wherever thrown.
 * 3. Anything else goes to the `onError` hook; if it returns an `ApiError`, that is sent.
 * 4. A Nest `HttpException` otherwise keeps its own status/body (client sees an `HttpError`).
 * 5. Everything else becomes `UNKNOWN_ERROR` (500). The cause is never sent.
 *
 * The server can never emit a non-handshake body for cases 2–5, and never logs.
 */
@Catch()
export class HandshakeExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(HANDSHAKE_OPTIONS) private readonly options: ResolvedOptions,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const httpAdapter = this.adapterHost.httpAdapter;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    if (exception instanceof RawResponseException) {
      const { response } = exception;
      response.headers.forEach((value, key) => httpAdapter.setHeader(res, key, value));
      const body = await response.text();
      httpAdapter.reply(res, body, response.status);
      return;
    }

    const req = ctx.getRequest<Record<PropertyKey, unknown>>();
    if (exception instanceof ApiError && this.isKnown(exception.code, req)) {
      this.replyEnvelope(httpAdapter, res, exception);
      return;
    }

    if (this.options.onError) {
      try {
        const mapped = await this.options.onError(exception, host);
        if (mapped instanceof ApiError) {
          this.replyEnvelope(httpAdapter, res, mapped);
          return;
        }
      } catch {
        // A throwing onError still yields a safe response — fall through.
      }
    }

    if (exception instanceof HttpException) {
      httpAdapter.reply(res, exception.getResponse(), exception.getStatus());
      return;
    }

    httpAdapter.reply(res, errorEnvelope("UNKNOWN_ERROR", 500, "Unknown error", undefined), 500);
  }

  private isKnown(code: string, req: Record<PropertyKey, unknown>): boolean {
    if ((RESERVED_ERROR_CODES as readonly string[]).includes(code)) return true;
    if (this.options.knownCodes?.has(code)) return true;
    const meta = req[HANDSHAKE_REQ_META] as HandshakeMeta | undefined;
    const errors = meta?.api.errors;
    return errors ? code in errors : false;
  }

  private replyEnvelope(httpAdapter: AbstractHttpAdapter, res: unknown, err: ApiError): void {
    httpAdapter.reply(
      res,
      errorEnvelope(err.code, err.status, err.message, err.details),
      err.status,
    );
  }
}
