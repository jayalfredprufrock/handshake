import type { Static, TSchema } from "typebox";
import type { Contract, Endpoint, EffectiveErrors, InferSchema } from "../contract";
import { ApiError, computeEffectiveErrors } from "../contract";

export type ClientOptions<E extends Endpoint> = {
  query?: InferSchema<E["query"]>;
  request?: Omit<RequestInit, "method" | "body">;
};

type ErrorCodes<S extends TSchema> = Static<S> extends { code: infer C } ? C & string : string;

export type EndpointErrorGuard<S extends TSchema | undefined> = S extends TSchema
  ? {
      (err: unknown): err is ApiError<Static<S>>;
      <C extends ErrorCodes<S>>(
        code: C,
      ): (err: unknown) => err is ApiError<Extract<Static<S>, { code: C }>>;
    }
  : (err: unknown) => err is ApiError;

export type ClientEndpoint<E extends Endpoint> = E["params"] extends TSchema
  ? E["body"] extends TSchema
    ? (
        params: InferSchema<E["params"]>,
        body: InferSchema<E["body"]>,
        options?: ClientOptions<E>,
      ) => Promise<InferSchema<E["response"]>>
    : (
        params: InferSchema<E["params"]>,
        options?: ClientOptions<E>,
      ) => Promise<InferSchema<E["response"]>>
  : E["body"] extends TSchema
    ? (
        body: InferSchema<E["body"]>,
        options?: ClientOptions<E>,
      ) => Promise<InferSchema<E["response"]>>
    : (options?: ClientOptions<E>) => Promise<InferSchema<E["response"]>>;

export type Client<
  C extends Record<string, Endpoint>,
  G extends TSchema | undefined = undefined,
> = {
  [E in keyof C]: C[E] &
    ClientEndpoint<C[E]> & {
      isApiError: EndpointErrorGuard<EffectiveErrors<G, C[E]["errors"]>>;
    };
};

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

// browser APIs don't allow null, so smooth over difference
export type IsomorphicSignal = NonNullable<RequestInit["signal"]>;

export type FetchFn = (
  input: string | URL,
  init?: Omit<RequestInit, "signal"> & { signal?: IsomorphicSignal },
) => Promise<unknown>;

export interface FetchClientConfig {
  fetch: FetchFn;
  baseUrl: string;
}

function makeEndpointIsApiError(_effectiveErrors: TSchema | undefined) {
  return function isApiError(errOrCode: unknown) {
    if (typeof errOrCode === "string") {
      const code = errOrCode;
      return (err: unknown) => err instanceof ApiError && err.body.code === code;
    }
    return errOrCode instanceof ApiError;
  };
}

export const createFetchClient = <
  C extends Record<string, Endpoint>,
  G extends TSchema | undefined = undefined,
>(
  contract: Contract<C, G>,
  config: FetchClientConfig,
): Client<C, G> => {
  const basePath = contract.basePath === "/" ? "" : contract.basePath;
  return Object.fromEntries(
    Object.entries(contract.endpoints).map(([name, endpoint]) => {
      const func = (...args: any[]) => {
        const { body, options, params } = extractArgs(endpoint, args);
        const path = `${config.baseUrl}${basePath}${replacePathParams(endpoint.path, params)}`;
        const queryString = options?.query ? buildQueryString(options.query) : "";
        const url = `${path}${queryString}`;

        return config.fetch(url, {
          method: endpoint.method,
          body,
          ...options?.request,
        });
      };

      const effectiveErrors = computeEffectiveErrors(
        (contract as Contract<any, any>).globalErrors,
        endpoint.errors,
      );
      const isApiError = makeEndpointIsApiError(effectiveErrors);

      Object.assign(func, endpoint, { isApiError });

      return [name, func];
    }),
  ) as never;
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
