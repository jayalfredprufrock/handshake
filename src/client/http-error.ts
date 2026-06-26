/**
 * Thrown by the client for a non-OK response that is **not** a handshake error
 * envelope — e.g. a proxy/gateway error, a CDN error page, or a non-handshake
 * backend. It carries the raw response so callers can still inspect the failure,
 * but it is deliberately distinct from `ApiError` (which models a handshake
 * contract error). `contract.isError(err)` is therefore `false` for an `HttpError`.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly response: Response,
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}
