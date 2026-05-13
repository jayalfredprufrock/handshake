import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { ApiError, isApiError } from "./api-error";

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

  test("preserves extra body fields", () => {
    const err = new ApiError(404, { code: "NOT_FOUND", resource: "user", id: "42" });
    expect(err.body.resource).toBe("user");
    expect(err.body.id).toBe("42");
  });
});

describe("isApiError", () => {
  test("returns true for ApiError instances", () => {
    const err = new ApiError(404, { code: "NOT_FOUND" });
    expect(isApiError(err)).toBe(true);
  });

  test("returns false for plain Error", () => {
    expect(isApiError(new Error("oops"))).toBe(false);
  });

  test("returns false for non-error values", () => {
    expect(isApiError("string")).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError(undefined)).toBe(false);
    expect(isApiError({ code: "NOT_FOUND" })).toBe(false);
  });

  test("narrows by code when provided", () => {
    const err = new ApiError(404, { code: "NOT_FOUND" });
    expect(isApiError(err, "NOT_FOUND")).toBe(true);
    expect(isApiError(err, "FORBIDDEN")).toBe(false);
  });

  test("returns false for ApiError with wrong code", () => {
    const err = new ApiError(403, { code: "FORBIDDEN" });
    expect(isApiError(err, "NOT_FOUND")).toBe(false);
  });

  describe("type narrowing", () => {
    test("narrows to ApiError without code", () => {
      const err: unknown = new ApiError(404, { code: "NOT_FOUND" });
      if (isApiError(err)) {
        expectTypeOf(err).toEqualTypeOf<ApiError>();
        expectTypeOf(err.body.code).toEqualTypeOf<string>();
      }
    });

    test("narrows body code to literal when code provided", () => {
      const err: unknown = new ApiError(404, { code: "NOT_FOUND" });
      if (isApiError(err, "NOT_FOUND")) {
        expectTypeOf(err.body.code).toEqualTypeOf<"NOT_FOUND">();
      }
    });
  });
});
