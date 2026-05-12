import type { Static, TSchema } from "typebox";

export type InferSchema<S> = S extends TSchema ? Static<S> : any;

export interface EndpointMeta extends Record<string, any> {}

export type MetaField<M> = {} extends M ? { meta?: M } : { meta: M };

export type Endpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  response: TSchema;
  params?: TSchema;
  body?: TSchema;
  query?: TSchema;
  description?: string;
} & MetaField<EndpointMeta>;

export interface Contract<C extends Record<string, Endpoint> = Record<string, Endpoint>> {
  basePath: string;
  endpoints: C;
}

export function createContract<const C extends Record<string, Endpoint>>(endpoints: C): Contract<C>;
export function createContract<const C extends Record<string, Endpoint>>(
  basePath: string,
  endpoints: C,
): Contract<C>;
export function createContract(
  basePathOrEndpoints: string | Record<string, Endpoint>,
  maybeEndpoints?: Record<string, Endpoint>,
): Contract {
  if (typeof basePathOrEndpoints === "string") {
    return { basePath: basePathOrEndpoints, endpoints: maybeEndpoints! };
  }
  return { basePath: "/", endpoints: basePathOrEndpoints };
}

export type ContractBody<C extends Contract> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["body"]>;
};

export type ContractResponse<C extends Contract> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["response"]>;
};

export type ContractParams<C extends Contract> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["params"]>;
};

export type ContractQuery<C extends Contract> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["query"]>;
};
