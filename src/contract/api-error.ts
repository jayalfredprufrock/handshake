export class ApiError<B = unknown> extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: B,
    public readonly response?: Response,
  ) {
    super(
      typeof body === "object" && body !== null && "code" in body
        ? String((body as { code: unknown }).code)
        : `HTTP ${statusCode}`,
    );
    this.name = "ApiError";
  }
}
