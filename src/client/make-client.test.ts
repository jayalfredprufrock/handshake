import { describe, expect, expectTypeOf, test, vi } from "vite-plus/test";
import * as T from "typebox";
import { ApiError, createContract, errorEnvelope } from "../contract";
import { createFetchClient, HttpError } from "../client";

const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const okFetch = (body: unknown) => vi.fn(async () => json(200, body));

const getUserContract = createContract("/api", {
  getUser: {
    method: "GET",
    path: "/users/:id",
    params: T.Object({ id: T.String() }),
    response: T.Object({ id: T.String() }),
  },
});

describe("createFetchClient URL building", () => {
  const capture = () => {
    let request: Request | undefined;
    const fetch = vi.fn(async (req: Request | string | URL) => {
      request = req as Request;
      return json(200, []);
    });
    return {
      fetch,
      get request() {
        return request!;
      },
    };
  };

  test("includes basePath", async () => {
    const cap = capture();
    const contract = createContract("/api/v1", {
      listUsers: { method: "GET", path: "/users", response: T.Array(T.Object({ id: T.String() })) },
    });
    await createFetchClient(contract, { fetch: cap.fetch, baseUrl: "https://x.com" }).listUsers();
    expect(cap.request.url).toBe("https://x.com/api/v1/users");
    expect(cap.request.method).toBe("GET");
  });

  test("omits basePath when default", async () => {
    const cap = capture();
    const contract = createContract({
      listUsers: { method: "GET", path: "/users", response: T.Array(T.Object({ id: T.String() })) },
    });
    await createFetchClient(contract, { fetch: cap.fetch, baseUrl: "https://x.com" }).listUsers();
    expect(cap.request.url).toBe("https://x.com/users");
  });

  test("replaces path params", async () => {
    const cap = capture();
    await createFetchClient(getUserContract, {
      fetch: cap.fetch,
      baseUrl: "https://x.com",
    }).getUser({
      id: "42",
    });
    expect(cap.request.url).toBe("https://x.com/api/users/42");
  });

  test("appends scalar and array query params", async () => {
    const cap = capture();
    const contract = createContract({
      search: {
        method: "GET",
        path: "/search",
        query: T.Object({ q: T.String(), tags: T.Array(T.String()) }),
        response: T.Object({ q: T.String() }),
      },
    });
    await createFetchClient(contract, { fetch: cap.fetch, baseUrl: "https://x.com" }).search({
      query: { q: "hi", tags: ["a", "b"] },
    });
    expect(cap.request.url).toBe("https://x.com/search?q=hi&tags=a&tags=b");
  });
});

describe("createFetchClient request/response pipeline", () => {
  test("defaults to globalThis.fetch", () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, []));
    const contract = createContract({
      list: { method: "GET", path: "/x", response: T.Array(T.Unknown()) },
    });
    const client = createFetchClient(contract, { baseUrl: "https://x.com" });
    return client.list().then(() => {
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  test("serializes a JSON body and sets content-type", async () => {
    let request: Request | undefined;
    const fetch = vi.fn(async (req: Request | string | URL) => {
      request = req as Request;
      return json(200, { id: "1" });
    });
    const contract = createContract({
      create: {
        method: "POST",
        path: "/users",
        body: T.Object({ name: T.String() }),
        response: T.Object({ id: T.String() }),
      },
    });
    await createFetchClient(contract, { fetch, baseUrl: "https://x.com" }).create({ name: "Ada" });
    expect(request!.method).toBe("POST");
    expect(request!.headers.get("content-type")).toBe("application/json");
    expect(await request!.text()).toBe(JSON.stringify({ name: "Ada" }));
  });

  test("resolves with the parsed body on success", async () => {
    const client = createFetchClient(getUserContract, {
      fetch: okFetch({ id: "1" }),
      baseUrl: "https://x.com",
    });
    await expect(client.getUser({ id: "1" })).resolves.toEqual({ id: "1" });
  });

  test("reconstructs an ApiError from a handshake error envelope", async () => {
    const fetch = vi.fn(async () =>
      json(404, errorEnvelope("NOT_FOUND", 404, "user 5 not found", undefined)),
    );
    const client = createFetchClient(getUserContract, { fetch, baseUrl: "https://x.com" });
    const err = await client.getUser({ id: "1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.message).toBe("user 5 not found");
    expect(err.response).toBeInstanceOf(Response);
  });

  test("reconstructs the details payload from the envelope", async () => {
    const fetch = vi.fn(async () =>
      json(409, errorEnvelope("CONFLICT", 409, "duplicate", { conflictingId: "7" })),
    );
    const client = createFetchClient(getUserContract, { fetch, baseUrl: "https://x.com" });
    const err = await client.getUser({ id: "1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CONFLICT");
    expect(err.details).toEqual({ conflictingId: "7" });
  });

  test("throws HttpError for a non-envelope (non-handshake) error response", async () => {
    const fetch = vi.fn(async () => json(502, { error: "bad gateway" }));
    const client = createFetchClient(getUserContract, { fetch, baseUrl: "https://x.com" });
    const err = await client.getUser({ id: "1" }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.body).toEqual({ error: "bad gateway" });
    expect(err.response).toBeInstanceOf(Response);
  });

  test("propagates a network error as-is", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const client = createFetchClient(getUserContract, { fetch, baseUrl: "https://x.com" });
    await expect(client.getUser({ id: "1" })).rejects.toBeInstanceOf(TypeError);
  });

  test("exposes the contract via $contract", () => {
    const client = createFetchClient(getUserContract, {
      fetch: okFetch({}),
      baseUrl: "https://x.com",
    });
    expect(client.$contract).toBe(getUserContract);
  });

  test("sends declared headers (and requires them when the schema does)", async () => {
    let request: Request | undefined;
    const fetch = vi.fn(async (req: Request | string | URL) => {
      request = req as Request;
      return json(200, { ok: true });
    });
    const contract = createContract({
      secret: {
        method: "GET",
        path: "/secret",
        headers: T.Object({ "x-api-key": T.String() }),
        response: T.Object({ ok: T.Boolean() }),
      },
    });
    const client = createFetchClient(contract, { fetch, baseUrl: "https://x.com" });

    await client.secret({ headers: { "x-api-key": "abc" } });
    expect(request!.headers.get("x-api-key")).toBe("abc");

    void (() => {
      // @ts-expect-error a required header means options must be provided
      void client.secret();
    });
  });
});

describe("createFetchClient hooks", () => {
  test("handleRequest can set headers", async () => {
    let request: Request | undefined;
    const fetch = vi.fn(async (req: Request | string | URL) => {
      request = req as Request;
      return json(200, { id: "1" });
    });
    const client = createFetchClient(getUserContract, {
      fetch,
      baseUrl: "https://x.com",
      handleRequest: (ctx) => {
        ctx.request.headers.set("authorization", "Bearer token");
      },
    });
    await client.getUser({ id: "1" });
    expect(request!.headers.get("authorization")).toBe("Bearer token");
  });

  test("handleResponse rejecting a 202 challenge is recovered by retry", async () => {
    class WafChallenge extends Error {}
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(202, {}, { "x-amzn-waf-action": "challenge" }))
      .mockResolvedValueOnce(json(200, { id: "1" }));
    const client = createFetchClient(getUserContract, {
      fetch,
      baseUrl: "https://x.com",
      handleResponse: (ctx) => {
        if (ctx.response?.status === 202) throw new WafChallenge();
      },
      retry: async (ctx) => ctx.error instanceof WafChallenge,
    });
    await expect(client.getUser({ id: "1" })).resolves.toEqual({ id: "1" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("retry recovers from a typed error via contract.isError", async () => {
    const contract = createContract(
      { me: { method: "GET", path: "/me", response: T.Object({ id: T.String() }) } },
      { errors: { TOKEN_EXPIRED: { status: 401 } } },
    );
    const refresh = vi.fn(async () => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, errorEnvelope("TOKEN_EXPIRED", 401, "expired", undefined)))
      .mockResolvedValueOnce(json(200, { id: "1" }));
    const client = createFetchClient(contract, {
      fetch,
      baseUrl: "https://x.com",
      retry: async (ctx) => {
        if (contract.isError(ctx.error, "TOKEN_EXPIRED")) {
          await refresh();
          return true;
        }
        return false;
      },
    });
    await expect(client.me()).resolves.toEqual({ id: "1" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("client typing", () => {
  test("endpoint return types are inferred", () => {
    const client = createFetchClient(getUserContract, {
      fetch: okFetch({}),
      baseUrl: "https://x.com",
    });
    expectTypeOf(client.getUser).returns.resolves.toEqualTypeOf<{ id: string }>();
  });

  test("options are required only when the query schema has a required property", () => {
    const contract = createContract({
      search: { method: "GET", path: "/s", query: T.Object({ q: T.String() }), response: T.Null() },
      list: {
        method: "GET",
        path: "/l",
        query: T.Object({ limit: T.Optional(T.Number()) }),
        response: T.Null(),
      },
      plain: { method: "GET", path: "/p", response: T.Null() },
    });
    const client = createFetchClient(contract, { fetch: okFetch(null), baseUrl: "https://x.com" });

    // type-only assertions; never executed
    void (() => {
      // @ts-expect-error a required query property means options must be provided
      void client.search();
      // @ts-expect-error query is required here
      void client.search({});
      void client.search({ query: { q: "hi" } });

      void client.list(); // query is all-optional → options optional
      void client.list({ query: { limit: 1 } });
      void client.plain(); // no query → options optional
    });
  });
});
