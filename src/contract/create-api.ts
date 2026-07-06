import type { TSchema } from "typebox";
import type {
  Contract,
  Endpoint,
  EndpointMeta,
  EntriesOf,
  ErrorEntry,
  ErrorFactory,
  ErrorGuard,
  ErrorMap,
  WithContractHeaders,
  WithContractMeta,
} from "./create-contract";
import {
  applyContractHeaders,
  applyContractMeta,
  makeErrorFactory,
  makeIsError,
} from "./create-contract";

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

/** Joins a base path and a route path into a single normalized path. */
export function joinPath(base: string, path: string): string {
  const normBase = base === "/" || base === "" ? "" : base.replace(/\/+$/, "");
  const normPath = path === "/" || path === "" ? "" : path.startsWith("/") ? path : `/${path}`;
  const joined = `${normBase}${normPath}`;
  return joined === "" ? "/" : joined;
}

function mergeErrorMaps(maps: (ErrorMap | undefined)[]): ErrorMap | undefined {
  const result: ErrorMap = {};
  let has = false;
  for (const map of maps) {
    if (!map) continue;
    for (const [code, def] of Object.entries(map)) {
      if (code in result) {
        throw new Error(`Duplicate error code "${code}" across the api's contracts`);
      }
      result[code] = def;
      has = true;
    }
  }
  return has ? result : undefined;
}

/** Options for {@link createApi} — cross-cutting concerns applied to every route. */
export interface ApiOptions<
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
  M extends EndpointMeta | undefined = undefined,
> {
  /** Errors recognized across the whole api (merged with each contract's own). */
  errors?: E;
  /** Header schema merged into every route's `headers` (route headers win). */
  headers?: H;
  /** Default meta merged into every route's `meta` (route meta wins). */
  meta?: M;
}

/**
 * Each group with its endpoints enriched by the api-level headers/meta. Structural
 * (not re-wrapped in `Contract<…>`) so the enriched endpoint map isn't checked
 * against `Contract`'s `Record<string, Endpoint>` bound at definition time. Meta is
 * merged first, then headers, so the merged meta keys survive.
 */
type EnrichGroups<
  G extends Record<string, Contract<any, any>>,
  H extends TSchema | undefined,
  M extends EndpointMeta | undefined,
> = {
  [K in keyof G]: Omit<G[K], "endpoints"> & {
    endpoints: WithContractHeaders<WithContractMeta<G[K]["endpoints"], M>, H>;
  };
};

/** The flat union of every group's endpoints (names are unique — enforced at runtime). */
export type MergeGroupEndpoints<G extends Record<string, Contract<any, any>>> =
  UnionToIntersection<{ [K in keyof G]: G[K]["endpoints"] }[keyof G]> extends infer M
    ? M extends Record<string, Endpoint>
      ? M
      : never
    : never;

/** The union of every group's declared error entries. */
export type ApiEntry<G extends Record<string, Contract<any, any>>> = {
  [K in keyof G]: NonNullable<G[K]["__entry"]>;
}[keyof G];

/**
 * A composed API: a named record of {@link Contract} groups plus cross-cutting
 * errors/headers/meta. This is the single unit the server adapters, fetch client,
 * and OpenAPI generator consume — a bare `Contract` is only a building block.
 */
export interface Api<
  G extends Record<string, Contract<any, any>> = Record<string, Contract<any, any>>,
  Entry extends ErrorEntry = never,
> {
  basePath: string;
  /** The named groups, each enriched with the api's headers/meta/errors. */
  contracts: G;
  /** Flat, enriched union of every group's endpoints (client + OpenAPI + nestjs read these). */
  endpoints: MergeGroupEndpoints<G>;
  errors?: ErrorMap;
  /** Error factory typed to the full merged error union. */
  error: ErrorFactory<Entry>;
  isError: ErrorGuard<Entry>;
  /** Phantom field carrying the error-entry union for inference; never set at runtime. */
  readonly __entry?: Entry;
}

export function createApi<const G extends Record<string, Contract<any, any>>>(
  contracts: G,
): Api<G, ApiEntry<G>>;
export function createApi<const G extends Record<string, Contract<any, any>>>(
  basePath: string,
  contracts: G,
): Api<G, ApiEntry<G>>;
export function createApi<
  const G extends Record<string, Contract<any, any>>,
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
  const M extends EndpointMeta | undefined = undefined,
>(
  basePath: string,
  contracts: G,
  options: ApiOptions<E, H, M>,
): Api<EnrichGroups<G, H, M>, ApiEntry<G> | EntriesOf<E>>;
export function createApi(
  basePathOrContracts: string | Record<string, Contract<any, any>>,
  contractsOrOptions?: Record<string, Contract<any, any>> | ApiOptions<any, any, any>,
  maybeOptions?: ApiOptions<any, any, any>,
): Api<any, any> {
  let basePath: string;
  let contracts: Record<string, Contract<any, any>>;
  let options: ApiOptions<any, any, any> | undefined;
  if (typeof basePathOrContracts === "string") {
    basePath = basePathOrContracts;
    contracts = contractsOrOptions as Record<string, Contract<any, any>>;
    options = maybeOptions;
  } else {
    basePath = "/";
    contracts = basePathOrContracts;
    options = contractsOrOptions as ApiOptions<any, any, any> | undefined;
  }

  const enrichedGroups: Record<string, Contract<any, any>> = {};
  const flat: Record<string, Endpoint> = {};

  for (const [groupName, group] of Object.entries(contracts)) {
    const enriched = applyContractHeaders(
      applyContractMeta(group.endpoints as Record<string, Endpoint>, options?.meta),
      options?.headers,
    );
    // Keep the group's own basePath/errors; adapters mount named groups at
    // joinPath(api.basePath, group.basePath) using these relative endpoint paths.
    enrichedGroups[groupName] = { ...group, endpoints: enriched };

    for (const [name, endpoint] of Object.entries(enriched)) {
      if (name in flat) {
        throw new Error(`Duplicate endpoint name "${name}" across the api's contracts`);
      }
      // Flat view carries group-prefixed paths; the api base path is applied by consumers.
      flat[name] = { ...endpoint, path: joinPath(group.basePath, endpoint.path) };
    }
  }

  const errors = mergeErrorMaps([
    ...Object.values(contracts).map((c) => c.errors),
    options?.errors,
  ]);

  return {
    basePath,
    contracts: enrichedGroups,
    endpoints: flat,
    errors,
    error: makeErrorFactory(errors),
    isError: makeIsError(),
  } as Api<any, any>;
}
