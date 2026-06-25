import { describe, expect, test } from "vite-plus/test";
import { ApiError } from "./api-error";

describe("ApiError", () => {
  test("extends Error and sets message to code", () => {
    const err = new ApiError(404, { code: "NOT_FOUND" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe("ApiError");
    expect(err.message).toBe("NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.body).toEqual({ code: "NOT_FOUND" });
  });

  test("falls back to an HTTP message when the body has no code", () => {
    const err = new ApiError(500, { error: "boom" });
    expect(err.message).toBe("HTTP 500");
  });

  test("preserves extra body fields", () => {
    const err = new ApiError(409, { code: "CONFLICT", conflictingId: "42" });
    expect((err.body as { conflictingId: string }).conflictingId).toBe("42");
  });

  test("carries the originating response when provided", () => {
    const response = new Response(null, { status: 404 });
    const err = new ApiError(404, { code: "NOT_FOUND" }, response);
    expect(err.response).toBe(response);
  });
});
