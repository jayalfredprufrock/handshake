import type {
  Contract,
  ContractWithApi,
  Endpoint,
  EntriesOf,
  ErrorEntry,
  ErrorMap,
} from "./create-contract";
import { buildContract } from "./create-contract";
import type { TSchema } from "typebox";
import * as T from "typebox";

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

type EndpointsOf<C> = C extends Contract<infer E, any, any> ? E : never;

type EntryOf<C> = C extends Contract<any, infer Entry, any> ? Entry : never;

type MergedEndpoints<T extends readonly Contract<any, any, any>[]> =
  UnionToIntersection<EndpointsOf<T[number]>> extends infer M
    ? M extends Record<string, Endpoint>
      ? M
      : never
    : never;

type MergedEndpointsFromRecord<N extends Record<string, Contract<any, any, any>>> =
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

export interface CombineContractsOptions<E extends ErrorMap | undefined = undefined> {
  basePath?: string;
  errors?: E;
}

function mergeErrorMaps(maps: (ErrorMap | undefined)[]): ErrorMap | undefined {
  const result: Record<number, TSchema> = {};
  let has = false;
  for (const map of maps) {
    if (!map) continue;
    for (const [statusStr, schema] of Object.entries(map)) {
      has = true;
      const status = Number(statusStr);
      const existing = result[status];
      result[status] = existing ? T.Union([existing, schema]) : schema;
    }
  }
  return has ? result : undefined;
}

export function combineContracts<const N extends Record<string, Contract<any, any, any>>>(
  contracts: N,
): ContractWithApi<MergedEndpointsFromRecord<N>, EntryOf<N[keyof N]> & ErrorEntry, N>;
export function combineContracts<
  const N extends Record<string, Contract<any, any, any>>,
  E extends ErrorMap | undefined = undefined,
>(
  contracts: N,
  options: CombineContractsOptions<E>,
): ContractWithApi<
  MergedEndpointsFromRecord<N>,
  (EntryOf<N[keyof N]> | EntriesOf<E>) & ErrorEntry,
  N
>;
export function combineContracts<const T extends readonly Contract<any, any, any>[]>(
  contracts: T,
): ContractWithApi<MergedEndpoints<T>, EntryOf<T[number]> & ErrorEntry>;
export function combineContracts<
  const T extends readonly Contract<any, any, any>[],
  E extends ErrorMap | undefined = undefined,
>(
  contracts: T,
  options: CombineContractsOptions<E>,
): ContractWithApi<MergedEndpoints<T>, (EntryOf<T[number]> | EntriesOf<E>) & ErrorEntry>;
export function combineContracts(
  contracts: readonly Contract<any, any, any>[] | Record<string, Contract<any, any, any>>,
  options?: CombineContractsOptions<any>,
): any {
  const basePath = options?.basePath ?? "/";
  const endpoints: Record<string, Endpoint> = {};

  const collect = (list: Contract<any, any, any>[]) => {
    for (const contract of list) {
      for (const [name, endpoint] of Object.entries(
        contract.endpoints as Record<string, Endpoint>,
      )) {
        if (name in endpoints)
          throw new Error(`Duplicate endpoint name "${name}" in combined contracts`);
        endpoints[name] = { ...endpoint, path: joinPath(contract.basePath, endpoint.path) };
      }
    }
  };

  if (Array.isArray(contracts)) {
    collect(contracts);
    const errors = mergeErrorMaps([...contracts.map((c) => c.errors), options?.errors]);
    return buildContract(basePath, endpoints, errors);
  }

  const named = contracts as Record<string, Contract<any, any, any>>;
  const list = Object.values(named);
  collect(list);
  const errors = mergeErrorMaps([...list.map((c) => c.errors), options?.errors]);
  return buildContract(basePath, endpoints, errors, named);
}
