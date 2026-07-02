import type {
  Contract,
  ContractWithApi,
  Endpoint,
  EndpointMeta,
  EntriesOf,
  ErrorEntry,
  ErrorMap,
  WithContractHeaders,
  WithContractMeta,
} from "./create-contract";
import { applyContractHeaders, applyContractMeta, buildContract } from "./create-contract";
import type { TSchema } from "typebox";

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

type EndpointsOf<C> = C extends Contract<infer E, any, any> ? E : never;

// Read the phantom `__entry` field by indexed access rather than inferring it
// from the constrained `Contract<any, infer Entry, any>` position: when a
// contract declares no errors its entry is `never`, and `infer` in a
// constrained position falls back to the constraint (`ErrorEntry`), which would
// otherwise poison the merged entry union and widen `code` to `string`.
type EntryOf<C> = C extends { readonly __entry?: infer Entry } ? NonNullable<Entry> : never;

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

export interface CombineContractsOptions<
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
  M extends EndpointMeta | undefined = undefined,
> {
  basePath?: string;
  errors?: E;
  /** Header schema merged into every combined route's `headers`. */
  headers?: H;
  /** Default meta merged into every combined route's `meta` (route meta takes precedence). */
  meta?: M;
}

function mergeErrorMaps(maps: (ErrorMap | undefined)[]): ErrorMap | undefined {
  const result: ErrorMap = {};
  let has = false;
  for (const map of maps) {
    if (!map) continue;
    for (const [code, def] of Object.entries(map)) {
      if (code in result) {
        throw new Error(`Duplicate error code "${code}" in combined contracts`);
      }
      result[code] = def;
      has = true;
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
  H extends TSchema | undefined = undefined,
  const M extends EndpointMeta | undefined = undefined,
>(
  contracts: N,
  options: CombineContractsOptions<E, H, M>,
): ContractWithApi<
  WithContractMeta<WithContractHeaders<MergedEndpointsFromRecord<N>, H>, M>,
  (EntryOf<N[keyof N]> | EntriesOf<E>) & ErrorEntry,
  N
>;
export function combineContracts<const T extends readonly Contract<any, any, any>[]>(
  contracts: T,
): ContractWithApi<MergedEndpoints<T>, EntryOf<T[number]> & ErrorEntry>;
export function combineContracts<
  const T extends readonly Contract<any, any, any>[],
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
  const M extends EndpointMeta | undefined = undefined,
>(
  contracts: T,
  options: CombineContractsOptions<E, H, M>,
): ContractWithApi<
  WithContractMeta<WithContractHeaders<MergedEndpoints<T>, H>, M>,
  (EntryOf<T[number]> | EntriesOf<E>) & ErrorEntry
>;
export function combineContracts(
  contracts: readonly Contract<any, any, any>[] | Record<string, Contract<any, any, any>>,
  options?: CombineContractsOptions<any, any, any>,
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
    return buildContract(
      basePath,
      applyContractMeta(applyContractHeaders(endpoints, options?.headers), options?.meta),
      errors,
    );
  }

  const named = contracts as Record<string, Contract<any, any, any>>;
  const list = Object.values(named);
  collect(list);
  const errors = mergeErrorMaps([...list.map((c) => c.errors), options?.errors]);
  return buildContract(
    basePath,
    applyContractMeta(applyContractHeaders(endpoints, options?.headers), options?.meta),
    errors,
    named,
  );
}
