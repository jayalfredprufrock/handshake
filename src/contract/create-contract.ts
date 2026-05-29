import type { Static, TSchema, TUnion } from "typebox";

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
  errors?: TSchema;
  description?: string;
} & MetaField<EndpointMeta>;

export interface Contract<
  C extends Record<string, Endpoint> = Record<string, Endpoint>,
  G extends TSchema | undefined = undefined,
  N extends Record<string, Contract<any, any>> | undefined = undefined,
> {
  basePath: string;
  endpoints: C;
  globalErrors?: G;
  named?: N;
}

export interface ContractOptions<G extends TSchema | undefined = undefined> {
  globalErrors?: G;
}

export function createContract<const C extends Record<string, Endpoint>>(endpoints: C): Contract<C>;
export function createContract<
  const C extends Record<string, Endpoint>,
  G extends TSchema | undefined = undefined,
>(endpoints: C, options: ContractOptions<G>): Contract<C, G>;
export function createContract<const C extends Record<string, Endpoint>>(
  basePath: string,
  endpoints: C,
): Contract<C>;
export function createContract<
  const C extends Record<string, Endpoint>,
  G extends TSchema | undefined = undefined,
>(basePath: string, endpoints: C, options: ContractOptions<G>): Contract<C, G>;
export function createContract(
  basePathOrEndpoints: string | Record<string, Endpoint>,
  endpointsOrOptions?: Record<string, Endpoint> | ContractOptions<any>,
  maybeOptions?: ContractOptions<any>,
): Contract {
  if (typeof basePathOrEndpoints === "string") {
    return {
      basePath: basePathOrEndpoints,
      endpoints: endpointsOrOptions as Record<string, Endpoint>,
      globalErrors: maybeOptions?.globalErrors,
    };
  }
  return {
    basePath: "/",
    endpoints: basePathOrEndpoints,
    globalErrors: (endpointsOrOptions as ContractOptions<any> | undefined)?.globalErrors,
  };
}

export type ExtractGlobalErrors<C> = C extends Contract<any, infer G, any> ? G : undefined;

export type EffectiveErrors<
  G extends TSchema | undefined,
  E extends TSchema | undefined,
> = G extends TSchema ? (E extends TSchema ? TUnion<[G, E]> : G) : E;

type EndpointErrorSchema<E> = E extends { errors: infer S extends TSchema } ? S : undefined;

export type ContractErrors<C extends Contract<any, any, any>> = {
  [K in keyof C["endpoints"]]: EffectiveErrors<
    ExtractGlobalErrors<C>,
    EndpointErrorSchema<C["endpoints"][K]>
  >;
};

export type ContractSchema<C extends Contract<any, any, any>> = {
  [E in keyof C["endpoints"]]: {
    body: InferSchema<C["endpoints"][E]["body"]>;
    response: InferSchema<C["endpoints"][E]["response"]>;
    params: InferSchema<C["endpoints"][E]["params"]>;
    query: InferSchema<C["endpoints"][E]["query"]>;
  };
};

export type ContractBody<C extends Contract<any, any, any>> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["body"]>;
};

export type ContractResponse<C extends Contract<any, any, any>> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["response"]>;
};

export type ContractParams<C extends Contract<any, any, any>> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["params"]>;
};

export type ContractQuery<C extends Contract<any, any, any>> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["query"]>;
};
