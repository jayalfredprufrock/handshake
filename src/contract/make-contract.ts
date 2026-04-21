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

export interface ContractDef<C extends Record<string, Endpoint> = Record<string, Endpoint>> {
  basePath: string;
  endpoints: C;
}

export type Contract = ContractDef;

export function makeContract<const C extends Record<string, Endpoint>>(
  endpoints: C,
): ContractDef<C>;
export function makeContract<const C extends Record<string, Endpoint>>(
  basePath: string,
  endpoints: C,
): ContractDef<C>;
export function makeContract(
  basePathOrEndpoints: string | Record<string, Endpoint>,
  maybeEndpoints?: Record<string, Endpoint>,
): ContractDef {
  if (typeof basePathOrEndpoints === "string") {
    return { basePath: basePathOrEndpoints, endpoints: maybeEndpoints! };
  }
  return { basePath: "/", endpoints: basePathOrEndpoints };
}
