import type { Contract, Endpoint } from "./create-contract";
import type { TSchema } from "typebox";

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

type EndpointsOf<C> = C extends Contract<infer E, any> ? E : never;

type MergedEndpoints<T extends readonly Contract<any, any>[]> =
  UnionToIntersection<EndpointsOf<T[number]>> extends infer M
    ? M extends Record<string, Endpoint>
      ? M
      : never
    : never;

type MergedEndpointsFromRecord<N extends Record<string, Contract<any, any>>> =
  UnionToIntersection<EndpointsOf<N[keyof N]>> extends infer M
    ? M extends Record<string, Endpoint>
      ? M
      : never
    : never;

export function joinPath(base: string, path: string): string {
  const normBase = base === "/" || base === "" ? "" : base.replace(/\/+$/, "");
  const normPath = path === "/" || path === "" ? "" : path.startsWith("/") ? path : `/${path}`;
  const joined = `${normBase}${normPath}`;
  return joined === "" ? "/" : joined;
}

export interface CombineContractsOptions<G extends TSchema | undefined = undefined> {
  basePath?: string;
  globalErrors?: G;
}

export function combineContracts<const N extends Record<string, Contract<any, any>>>(
  contracts: N,
): Contract<MergedEndpointsFromRecord<N>, undefined, N>;
export function combineContracts<
  const N extends Record<string, Contract<any, any>>,
  G extends TSchema | undefined = undefined,
>(contracts: N, options: CombineContractsOptions<G>): Contract<MergedEndpointsFromRecord<N>, G, N>;
export function combineContracts<const T extends readonly Contract<any, any>[]>(
  contracts: T,
): Contract<MergedEndpoints<T>>;
export function combineContracts<
  const T extends readonly Contract<any, any>[],
  G extends TSchema | undefined = undefined,
>(contracts: T, options: CombineContractsOptions<G>): Contract<MergedEndpoints<T>, G>;
export function combineContracts(
  contracts: readonly Contract<any, any>[] | Record<string, Contract<any, any>>,
  options?: CombineContractsOptions<any>,
): Contract {
  const basePath = options?.basePath ?? "/";
  const endpoints: Record<string, Endpoint> = {};

  if (Array.isArray(contracts)) {
    for (const contract of contracts) {
      for (const [name, endpoint] of Object.entries(contract.endpoints)) {
        if (name in endpoints)
          throw new Error(`Duplicate endpoint name "${name}" in combined contracts`);
        endpoints[name] = { ...endpoint, path: joinPath(contract.basePath, endpoint.path) };
      }
    }
    return { basePath, endpoints, globalErrors: options?.globalErrors };
  }

  const named = contracts as Record<string, Contract<any, any>>;
  for (const [, contract] of Object.entries(named)) {
    for (const [name, endpoint] of Object.entries(contract.endpoints)) {
      if (name in endpoints)
        throw new Error(`Duplicate endpoint name "${name}" in combined contracts`);
      endpoints[name] = { ...endpoint, path: joinPath(contract.basePath, endpoint.path) };
    }
  }
  return { basePath, endpoints, globalErrors: options?.globalErrors, named };
}
