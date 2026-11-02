import type { TSchema } from "typebox";
import type {
  AsEndpoints,
  ClientRequestDefaults,
  Contract,
  ContractBody,
  ContractHeaders,
  ContractParams,
  ContractQuery,
  ContractResponse,
  ContractSchema,
  Endpoint,
  EndpointMeta,
  EnrichEndpoints,
  EntriesOf,
  ErrorEntry,
  ErrorFactory,
  ErrorGuard,
  ErrorMap,
  FrameworkEntries,
  HasEndpoints,
} from "./create-contract";
import {
  applyContractClient,
  applyContractHeaders,
  applyContractMeta,
  makeErrorFactory,
  makeIsError,
} from "./create-contract";

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
  Cl extends ClientRequestDefaults | undefined = undefined,
> {
  /** Errors recognized across the whole api (merged with each contract's own). */
  errors?: E;
  /** Header schema merged into every route's `headers` (route headers win). */
  headers?: H;
  /** Default meta merged into every route's `meta` (route meta wins). */
  meta?: M;
  /** Client `RequestInit` defaults merged into every route's own (route keys win). */
  client?: Cl;
}

/** The error-entry union a contract carries in its phantom `__entry` field. */
type EntryOf<C> = C extends { readonly __entry?: infer Entry extends ErrorEntry } ? Entry : never;

/**
 * Each group with its endpoints enriched by the api-level headers/meta/client,
 * re-wrapped as a plain `Contract` so declaration emit prints only the enriched
 * endpoints (not the original map alongside them).
 */
type EnrichGroups<
  G extends Record<string, Contract<any, any>>,
  H extends TSchema | undefined,
  M extends EndpointMeta | undefined,
  Cl extends ClientRequestDefaults | undefined,
> = {
  [K in keyof G]: Contract<EnrichEndpoints<G[K]["endpoints"], H, M, Cl>, EntryOf<G[K]>>;
};

/**
 * An endpoint as it appears in the flat {@link Api.endpoints} view. Its `path` there
 * is prefixed with the group's base path at runtime; contract base paths aren't
 * tracked as literals, so the path widens to `string` rather than keep a wrong literal.
 */
type FlatEndpoint<E> = { [P in keyof E]: P extends "path" ? string : E[P] };

/** Every `[name, endpoint]` pair across the groups, as a union (linear in endpoints). */
type EndpointEntry<G extends Record<string, Contract<any, any>>> = {
  [K in keyof G]: {
    [N in keyof G[K]["endpoints"]]: [N, FlatEndpoint<G[K]["endpoints"][N]>];
  }[keyof G[K]["endpoints"]];
}[keyof G];

/** The flat map of every group's endpoints (names are unique — enforced by {@link UniqueEndpoints}). */
export type MergeGroupEndpoints<G extends Record<string, Contract<any, any>>> = AsEndpoints<{
  [Entry in EndpointEntry<G> as Entry[0]]: Entry[1];
}>;

/** Endpoint names declared by more than one group. */
type DuplicateEndpointNames<G extends Record<string, Contract<any, any>>> = {
  [K in keyof G]: keyof G[K]["endpoints"] &
    { [J in Exclude<keyof G, K>]: keyof G[J]["endpoints"] }[Exclude<keyof G, K>];
}[keyof G];

/**
 * Rejects groups whose endpoint names collide (the runtime would throw): each
 * duplicated name must also satisfy an error-message string, which no endpoint can.
 */
type UniqueEndpoints<G extends Record<string, Contract<any, any>>> = [
  DuplicateEndpointNames<G>,
] extends [never]
  ? unknown
  : {
      [K in keyof G]: {
        endpoints: {
          [N in DuplicateEndpointNames<G> &
            keyof G[K]["endpoints"]]: "Duplicate endpoint name across the api's contracts";
        };
      };
    };

/** The union of every group's declared error entries, plus the always-available framework ones. */
export type ApiEntry<G extends Record<string, Contract<any, any>>> =
  | FrameworkEntries
  | EntryOf<G[keyof G]>;

/**
 * A composed API: a named record of {@link Contract} groups plus cross-cutting
 * errors/headers/meta. This is the single unit the server adapters, fetch client,
 * and OpenAPI generator consume — a bare `Contract` is only a building block.
 */
export interface Api<
  G extends Record<string, Contract<any, any>> = Record<string, Contract<any, any>>,
  Entry extends ErrorEntry = FrameworkEntries,
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

// Return types spell out the entry union inline (rather than `ApiEntry<G>`) so
// declaration emit prints the resolved union instead of re-serializing all of `G`.
export function createApi<const G extends Record<string, Contract<any, any>>>(
  contracts: G & UniqueEndpoints<G>,
): Api<G, FrameworkEntries | EntryOf<G[keyof G]>>;
export function createApi<const G extends Record<string, Contract<any, any>>>(
  basePath: string,
  contracts: G & UniqueEndpoints<G>,
): Api<G, FrameworkEntries | EntryOf<G[keyof G]>>;
export function createApi<
  const G extends Record<string, Contract<any, any>>,
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
  const M extends EndpointMeta | undefined = undefined,
  const Cl extends ClientRequestDefaults | undefined = undefined,
>(
  basePath: string,
  contracts: G & UniqueEndpoints<G>,
  options: ApiOptions<E, H, M, Cl>,
): Api<EnrichGroups<G, H, M, Cl>, FrameworkEntries | EntryOf<G[keyof G]> | EntriesOf<E>>;
export function createApi(
  basePathOrContracts: string | Record<string, Contract<any, any>>,
  contractsOrOptions?: Record<string, Contract<any, any>> | ApiOptions<any, any, any, any>,
  maybeOptions?: ApiOptions<any, any, any, any>,
): Api<any, any> {
  let basePath: string;
  let contracts: Record<string, Contract<any, any>>;
  let options: ApiOptions<any, any, any, any> | undefined;
  if (typeof basePathOrContracts === "string") {
    basePath = basePathOrContracts;
    contracts = contractsOrOptions as Record<string, Contract<any, any>>;
    options = maybeOptions;
  } else {
    basePath = "/";
    contracts = basePathOrContracts;
    options = contractsOrOptions as ApiOptions<any, any, any, any> | undefined;
  }

  const enrichedGroups: Record<string, Contract<any, any>> = {};
  const flat: Record<string, Endpoint> = {};

  for (const [groupName, group] of Object.entries(contracts)) {
    const enriched = applyContractClient(
      applyContractHeaders(
        applyContractMeta(group.endpoints as Record<string, Endpoint>, options?.meta),
        options?.headers,
      ),
      options?.client,
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

/**
 * `Api`-oriented aliases for the endpoint-shape extractors. The composed {@link Api}
 * is the unit these are most often applied to, so these read more naturally than the
 * `Contract*` originals — but, like them, they accept any {@link HasEndpoints} (a bare
 * {@link Contract} or an {@link Api}).
 */
export type ApiSchema<A extends HasEndpoints> = ContractSchema<A>;
export type ApiBody<A extends HasEndpoints> = ContractBody<A>;
export type ApiResponse<A extends HasEndpoints> = ContractResponse<A>;
export type ApiParams<A extends HasEndpoints> = ContractParams<A>;
export type ApiQuery<A extends HasEndpoints> = ContractQuery<A>;
export type ApiHeaders<A extends HasEndpoints> = ContractHeaders<A>;
