import type { TSchema } from "typebox";
import type { Contract, Endpoint, InferSchema } from "../contract";
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

/** The full request context handed to `handleResponse` and `retry`. */
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
  /** Decide whether to retry a failed attempt. Return `true` to re-issue the request. */
  retry?: (ctx: ResponseContext) => boolean | Promise<boolean>;
}

export type ClientOf<Ct extends Contract<any, any, any>> =
  Ct extends Contract<infer C, any, any>
    ? { [E in keyof C]: C[E] & ClientEndpoint<C[E]> } & { $contract: Ct }
    : never;

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

async function runRequest(
  config: FetchClientConfig,
  fetchImpl: typeof globalThis.fetch,
  spec: RequestSpec,
  attempt = 1,
): Promise<unknown> {
  // Declared headers first; then options.request.headers (and later handleRequest) win.
  const headers = new Headers();
  for (const [key, value] of Object.entries(spec.headers ?? {})) {
    if (value !== undefined && value !== null) headers.set(key, String(value));
  }
  if (spec.init?.headers) new Headers(spec.init.headers).forEach((v, k) => headers.set(k, v));

  const init: RequestInit = { ...spec.init, method: spec.method, headers };
  if (spec.body !== undefined) {
    init.body = JSON.stringify(spec.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  let request = new Request(spec.url, init);

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

  if (config.retry && (await config.retry(ctx))) {
    return runRequest(config, fetchImpl, spec, attempt + 1);
  }

  throw ctx.error;
}

export const createFetchClient = <Ct extends Contract<any, any, any>>(
  contract: Ct,
  config: FetchClientConfig,
): ClientOf<Ct> => {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const basePath = contract.basePath === "/" ? "" : contract.basePath;

  const client: Record<string, unknown> = { $contract: contract };

  for (const [name, endpoint] of Object.entries(contract.endpoints as Record<string, Endpoint>)) {
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

  return client as ClientOf<Ct>;
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
