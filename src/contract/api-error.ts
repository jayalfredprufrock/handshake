/** Discriminator stamped on every handshake error envelope so the client can
 * tell a handshake error response apart from any other non-OK body. */
export const HANDSHAKE_ERROR_KIND = "HANDSHAKE";

/** A normalized validation issue — the element type of a `VALIDATION_ERROR`'s `details`. */
export interface ValidationIssue {
  /** Dot-notation location of the offending value (omitted for a root-level issue). */
  path?: string;
  /** The validation keyword that failed (e.g. `"type"`, `"required"`), when available. */
  keyword?: string;
  message: string;
}

/** The wire shape of a handshake error response. */
export interface ErrorEnvelope<Code extends string = string, Details = unknown> {
  kind: typeof HANDSHAKE_ERROR_KIND;
  code: Code;
  status: number;
  message: string;
  details?: Details;
}

export interface ApiErrorInit<Code extends string = string, Details = unknown> {
  code: Code;
  status: number;
  message?: string;
  details?: Details;
  /** Client-only: the originating `Response`. Never serialized. */
  response?: Response;
}

/**
 * The error type for a handshake contract. It mirrors the wire envelope
 * (`{ code, status, message, details }`) and is thrown on the server (via
 * `contract.error`) and reconstructed on the client from the envelope. Foreign
 * (non-handshake) error responses are surfaced as {@link "../client/http-error".HttpError}, never `ApiError`.
 */
export class ApiError<Code extends string = string, Details = unknown> extends Error {
  readonly code: Code;
  readonly status: number;
  readonly details: Details;
  readonly response?: Response;

  constructor(init: ApiErrorInit<Code, Details>) {
    super(init.message ?? init.code ?? `HTTP ${init.status}`);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details as Details;
    this.response = init.response;
  }
}

/** Builds the wire envelope for an error response. */
export function errorEnvelope(
  code: string,
  status: number,
  message: string,
  details: unknown,
): ErrorEnvelope {
  return { kind: HANDSHAKE_ERROR_KIND, code, status, message, details };
}

/** Narrows a parsed response body to a handshake error envelope by its brand. */
export function isErrorEnvelope(data: unknown): data is ErrorEnvelope {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { kind?: unknown }).kind === HANDSHAKE_ERROR_KIND
  );
}
