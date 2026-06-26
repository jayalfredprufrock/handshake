import { describe, expect, test } from "vite-plus/test";
import { ApiError, errorEnvelope, isErrorEnvelope } from "./api-error";

describe("ApiError", () => {
  test("mirrors the envelope; message falls back to the code", () => {
    const err = new ApiError({ code: "NOT_FOUND", status: 404 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe("ApiError");
    expect(err.message).toBe("NOT_FOUND");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.details).toBeUndefined();
  });

  test("uses an explicit message and carries details", () => {
    const err = new ApiError({
      code: "CONFLICT",
      status: 409,
      message: "duplicate transfer",
      details: { conflictingId: "42" },
    });
    expect(err.message).toBe("duplicate transfer");
    expect(err.details).toEqual({ conflictingId: "42" });
  });

  test("carries the originating response when provided", () => {
    const response = new Response(null, { status: 404 });
    const err = new ApiError({ code: "NOT_FOUND", status: 404, response });
    expect(err.response).toBe(response);
  });
});

describe("error envelope", () => {
  test("errorEnvelope stamps the HANDSHAKE brand", () => {
    expect(errorEnvelope("NOT_FOUND", 404, "not found", undefined)).toEqual({
      kind: "HANDSHAKE",
      code: "NOT_FOUND",
      status: 404,
      message: "not found",
      details: undefined,
    });
  });

  test("isErrorEnvelope detects the brand", () => {
    expect(isErrorEnvelope(errorEnvelope("X", 400, "m", undefined))).toBe(true);
    expect(isErrorEnvelope({ code: "X", status: 400, message: "m" })).toBe(false); // no brand
    expect(isErrorEnvelope({ error: "nope" })).toBe(false);
    expect(isErrorEnvelope("string")).toBe(false);
    expect(isErrorEnvelope(null)).toBe(false);
  });
});
