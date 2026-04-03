import type { Static, TSchema } from "typebox";
import type { ContractDef, Endpoint } from "../contract";

// TODO: this could handle the "none" case too and resolve to never
export type InferSchema<S> = S extends TSchema ? Static<S> : any;

// TODO: is it possible to infer whether there are any required properties of query?
export type ClientOptions<E extends Endpoint> = {
  query?: InferSchema<E["query"]>;
  request?: Omit<RequestInit, "method" | "body">;
};

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

export type Client<C extends Record<string, Endpoint>> = {
  [E in keyof C]: C[E] & ClientEndpoint<C[E]>;
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

export const createFetchClient = <C extends Record<string, Endpoint>>(
  contract: ContractDef<C>,
  config: FetchClientConfig,
): Client<C> => {
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

      Object.assign(func, endpoint);

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
