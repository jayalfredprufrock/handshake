import type { TSchema } from "typebox";
import type { Api, Endpoint, InferSchema } from "../contract";
import { ApiError, isErrorEnvelope } from "../contract";
import { HttpError } from "./http-error";

type ClientRequestInit = Omit<RequestInit, "method" | "body">;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** A `{ key: value }` field that's required only when its schema has a required property. */
type SchemaField<Key extends string, S> = S extends TSchema
  ? {} extends InferSchema<S>
    ? { [K in Key]?: InferSchema<S> }
    : { [K in Key]: InferSchema<S> }
  : {};

export type ClientOptions<E extends Endpoint> = Simplify<
  SchemaField<"query", E["query"]> &
    SchemaField<"headers", E["headers"]> & { request?: ClientRequestInit }
>;

/** The trailing `options` arg, required only when `ClientOptions` has a required field. */
type OptionsArgs<E extends Endpoint> =
  {} extends ClientOptions<E> ? [options?: ClientOptions<E>] : [options: ClientOptions<E>];

export type ClientEndpoint<E extends Endpoint> = E["params"] extends TSchema
  ? E["body"] extends TSchema
    ? (
        params: InferSchema<E["params"]>,
        body: InferSchema<E["body"]>,
        ...options: OptionsArgs<E>
      ) => Promise<InferSchema<E["response"]>>
    : (
        params: InferSchema<E["params"]>,
        ...options: OptionsArgs<E>
      ) => Promise<InferSchema<E["response"]>>
  : E["body"] extends TSchema
    ? (
        body: InferSchema<E["body"]>,
        ...options: OptionsArgs<E>
      ) => Promise<InferSchema<E["response"]>>
    : (...options: OptionsArgs<E>) => Promise<InferSchema<E["response"]>>;

/** The full request context handed to `handleResponse`. */
export interface ResponseContext {
  request: Request;
  /** The response, or `undefined` when the fetch itself rejected (network error). */
  response?: Response;
  /** The parsed response body. */
  data: unknown;
  /** 1-based attempt number. */
  attempt: number;
  /**
   * The pending failure for this attempt: an `ApiError` for a non-OK response, the
   * raw error for a network rejection, or `undefined` for a successful response.
   * `handleResponse` may throw to override it.
   */
  error?: unknown;
}

/**
 * The context handed to `retry`. Narrows {@link ResponseContext}: `retry` only runs
 * for a failed attempt, so `error` is always present (an `ApiError` for a non-OK
 * response, the raw error for a network rejection, or whatever `handleResponse` threw).
 * `request` is the request that was sent, for inspection; to reshape the next attempt,
 * return {@link RetryOverrides} rather than mutating it.
 */
export interface RetryContext extends ResponseContext {
  error: unknown;
}

/** Header overrides: a friendly record (numbers/booleans allowed) or a standard
 * `HeadersInit` (a `Headers` instance or `[name, value]` pairs). */
export type OverrideHeaders =
  | Record<string, string | number | boolean | undefined>
  | Headers
  | [string, string][];

/**
 * Overrides `retry` may return to reshape the retried request — a fetch `RequestInit`
 * (`signal`, `credentials`, `cache`, …) plus `url`, and with `headers` widened to also
 * accept a friendly record. They are merged over the original call — so the body is
 * re-serialized each attempt — and accumulate across retries. `handleRequest` still runs
 * afterward and wins. Returning any overrides (even `{}`) implies a retry; return `true`
 * to retry unchanged.
 */
export interface RetryOverrides extends Omit<ClientRequestInit, "headers"> {
  /** Header values to set, applied last so they win over the call's own headers. */
  headers?: OverrideHeaders;
  /** Replace the request URL (including any query string). */
  url?: string;
  /** Replace the HTTP method. */
  method?: string;
  /** Replace the JSON request body (re-serialized on the retried attempt). */
  body?: unknown;
}

/** What `retry` returns: `false`/nothing to stop, `true` to retry as-is, overrides to reshape. */
export type RetryDecision = boolean | RetryOverrides;

/** The context handed to `handleRequest` before a request is sent. */
export interface RequestContext {
  request: Request;
  attempt: number;
}

export interface FetchClientConfig {
  baseUrl: string;
  /** The fetch implementation to use. Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Inspect/mutate or replace the outgoing request (e.g. auth headers). Re-runs each attempt. */
  handleRequest?: (ctx: RequestContext) => Request | void | Promise<Request | void>;
  /** Inspect every response; throw to reject an otherwise-successful response or reshape an error. */
  handleResponse?: (ctx: ResponseContext) => void | Promise<void>;
  /**
   * Decide whether to retry a failed attempt. Return `true` (or a {@link RetryOverrides}
   * patch to reshape the request) to re-issue it; `false` or nothing to give up and throw.
   */
  retry?: (ctx: RetryContext) => RetryDecision | void | Promise<RetryDecision | void>;
}

export type ClientOf<A extends Api<any, any>> = {
  [E in keyof A["endpoints"] as A["endpoints"][E]["internal"] extends true
    ? never
    : E]: A["endpoints"][E] & ClientEndpoint<A["endpoints"][E]>;
} & { $api: A };

const extractArgs = (endpoint: Endpoint, args: any[]) => {
  const extractedArgs: Record<string, any> = {};
  const clonedArgs = args.slice();
  if (endpoint.params) {
    extractedArgs.params = clonedArgs.shift();
  }
  if (endpoint.body) {
    extractedArgs.body = clonedArgs.shift();
  }
  extractedArgs.options = clonedArgs.shift();
  return extractedArgs;
};

const replacePathParams = (path: string, params: any): string => {
  const segments = path.split("/");
  return segments
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const param = segment.slice(1);
      if (!params[param]) {
        throw new Error(`Missing path param "${param}"`);
      }
      return params[param];
    })
    .join("/");
};

type QueryValue = string | number | boolean;

const buildQueryString = (query: Record<string, QueryValue | QueryValue[]>): string => {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        entries.push([key, String(item)]);
      }
    } else {
      entries.push([key, String(value)]);
    }
  }
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries).toString()}`;
};

const parseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * Builds the error for a non-OK response. A handshake server stamps its error
 * envelope with `kind: "HANDSHAKE"`, so that brand is reconstructed 1:1 into an
 * `ApiError`. Any other non-OK body (e.g. a proxy/gateway or a non-handshake
 * backend) becomes an `HttpError` carrying the raw body and response.
 */
const toResponseError = (
  data: unknown,
  httpStatus: number,
  response: Response,
): ApiError | HttpError => {
  if (isErrorEnvelope(data)) {
    return new ApiError({
      code: data.code,
      status: data.status,
      message: data.message,
      details: data.details,
      response,
    });
  }
  return new HttpError(httpStatus, data, response);
};

interface RequestSpec {
  url: string;
  method: string;
  body: unknown;
  init: ClientRequestInit | undefined;
  headers: Record<string, string | number | boolean | undefined> | undefined;
}

/** Applies headers onto `target`, accepting either a friendly record (numbers/booleans
 * coerced, nullish skipped) or any standard `HeadersInit`. */
function applyHeaders(target: Headers, source: OverrideHeaders | undefined): void {
  if (!source) return;
  if (source instanceof Headers || Array.isArray(source)) {
    new Headers(source).forEach((value, key) => target.set(key, value));
    return;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) target.set(key, String(value));
  }
}

/**
 * Builds the `Request` for an attempt from the call's {@link RequestSpec} plus any
 * accumulated retry {@link RetryOverrides} (override headers/method/url/body/init win;
 * a later `handleRequest` can still override those).
 */
function buildRequestFromSpec(spec: RequestSpec, overrides?: RetryOverrides): Request {
  const { url, method, body, headers: overrideHeaders, ...initOverrides } = overrides ?? {};

  // Headers low-to-high precedence: declared, then options.request, then retry overrides.
  const headers = new Headers();
  applyHeaders(headers, spec.headers);
  applyHeaders(headers, spec.init?.headers);
  applyHeaders(headers, overrideHeaders);

  // Override init (signal, credentials, …) wins over the call's; method/headers are set
  // explicitly afterward so they aren't clobbered by the spread.
  const init: RequestInit = {
    ...spec.init,
    ...initOverrides,
    method: method ?? spec.method,
    headers,
  };
  const finalBody = overrides && "body" in overrides ? body : spec.body;
  if (finalBody !== undefined) {
    init.body = JSON.stringify(finalBody);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  return new Request(url ?? spec.url, init);
}

/** Accumulates retry overrides so an earlier attempt's changes persist into later ones. */
function mergeOverrides(prev: RetryOverrides | undefined, next: RetryOverrides): RetryOverrides {
  const merged: RetryOverrides = { ...prev, ...next };
  if (prev?.headers || next.headers) {
    // Headers may be records or HeadersInit; fold both into one Headers to merge them.
    const headers = new Headers();
    applyHeaders(headers, prev?.headers);
    applyHeaders(headers, next.headers);
    merged.headers = headers;
  }
  return merged;
}

async function runRequest(
  config: FetchClientConfig,
  fetchImpl: typeof globalThis.fetch,
  spec: RequestSpec,
  attempt = 1,
  overrides?: RetryOverrides,
): Promise<unknown> {
  // Each attempt rebuilds a fresh request from the spec (so the body is re-serialized)
  // with the overrides a prior `retry` accumulated merged in.
  let request = buildRequestFromSpec(spec, overrides);

  if (config.handleRequest) {
    const replaced = await config.handleRequest({ request, attempt });
    if (replaced) request = replaced;
  }

  const ctx: ResponseContext = { request, attempt, data: undefined };

  try {
    ctx.response = await fetchImpl(request);
  } catch (networkError) {
    ctx.error = networkError;
  }

  if (ctx.response) {
    ctx.data = await parseBody(ctx.response);
    if (!ctx.response.ok) {
      ctx.error = toResponseError(ctx.data, ctx.response.status, ctx.response);
    }
  }

  if (config.handleResponse) {
    try {
      await config.handleResponse(ctx);
    } catch (thrown) {
      ctx.error = thrown;
    }
  }

  if (ctx.error === undefined) {
    return ctx.data;
  }

  // `error` is defined past the guard above, so `ctx` satisfies `RetryContext`. A truthy
  // decision retries; an overrides object also reshapes (and accumulates onto) the next one.
  if (config.retry) {
    const decision = await config.retry(ctx as RetryContext);
    if (decision) {
      const next = decision === true ? overrides : mergeOverrides(overrides, decision);
      return runRequest(config, fetchImpl, spec, attempt + 1, next);
    }
  }

  throw ctx.error;
}

export const createFetchClient = <A extends Api<any, any>>(
  api: A,
  config: FetchClientConfig,
): ClientOf<A> => {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const basePath = api.basePath === "/" ? "" : api.basePath;

  const client: Record<string, unknown> = { $api: api };

  for (const [name, endpoint] of Object.entries(api.endpoints as Record<string, Endpoint>)) {
    if (endpoint.internal) continue;
    const func = (...args: any[]) => {
      const { body, options, params } = extractArgs(endpoint, args);
      const path = `${config.baseUrl}${basePath}${replacePathParams(endpoint.path, params)}`;
      const queryString = options?.query ? buildQueryString(options.query) : "";
      const url = `${path}${queryString}`;
      return runRequest(config, fetchImpl, {
        url,
        method: endpoint.method,
        body,
        init: options?.request,
        headers: options?.headers,
      });
    };
    Object.assign(func, endpoint);
    client[name] = func;
  }

  return client as ClientOf<A>;
};

export type StaticEndpoint<E extends Endpoint> = {
  method: E["method"];
  path: E["path"];
  response: InferSchema<E["response"]>;
  params: InferSchema<E["params"]>;
  body: InferSchema<E["body"]>;
  query: InferSchema<E["query"]>;
};

export type StaticApi<C extends Record<string, Endpoint>, E> = E extends keyof C
  ? StaticEndpoint<C[E]>
  : never;
