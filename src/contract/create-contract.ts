import type { Static, TComposite, TSchema } from "typebox";
import * as T from "typebox";
import { ApiError } from "./api-error";
import type { ValidationIssue } from "./api-error";

export type InferSchema<S> = S extends TSchema ? Static<S> : any;

export interface EndpointMeta extends Record<string, any> {}

export type MetaField<M> = {} extends M ? { meta?: M } : { meta: M };

export type Endpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  response: TSchema;
  /** Status code for a successful response. Defaults to 200. */
  responseCode?: number;
  params?: TSchema;
  body?: TSchema;
  query?: TSchema;
  /** Request header schema. Header names must be declared in lowercase. */
  headers?: TSchema;
  description?: string;
  /**
   * Marks the endpoint as server-only. It is still implemented and served by the
   * adapters, but is excluded from the generated fetch client and the OpenAPI
   * document.
   */
  internal?: boolean;
} & MetaField<EndpointMeta>;

/** A single declared error: its HTTP status and an optional `details` schema. */
export interface ErrorDef {
  status: number;
  details?: TSchema;
}

/** Maps an error `code` to its {@link ErrorDef}. Codes are unique by construction. */
export type ErrorMap = Record<string, ErrorDef>;

type DetailsOf<D extends ErrorDef> = D["details"] extends TSchema
  ? Static<D["details"]>
  : undefined;

/** A single flattened (code, status, details) error variant from an {@link ErrorMap}. */
export interface ErrorEntry {
  code: string;
  status: number;
  details: unknown;
}

/** Flattens an {@link ErrorMap} into the union of its (code, status, details) variants. */
export type EntriesOf<E extends ErrorMap | undefined> = E extends ErrorMap
  ? {
      [Code in Extract<keyof E, string>]: {
        code: Code;
        status: E[Code]["status"];
        details: DetailsOf<E[Code]>;
      };
    }[Extract<keyof E, string>]
  : never;

/**
 * Framework error entries — always available via `contract.error`/`isError`,
 * emitted by the framework, and not declarable in a contract's error map. The
 * `details` shapes mirror what the adapter sends (kept in sync with the codes in
 * {@link RESERVED_ERROR_CODES} / `FRAMEWORK_ERROR_STATUS`).
 */
export type FrameworkEntries =
  | { code: "VALIDATION_ERROR"; status: 400; details: ValidationIssue[] | undefined }
  | { code: "UNKNOWN_ERROR"; status: 500; details: undefined };

/** The full error-entry union a contract exposes: framework errors + declared errors. */
export type ContractEntries<E extends ErrorMap | undefined> = FrameworkEntries | EntriesOf<E>;

/** The `ApiError` type for an entry union (a discriminated union of `ApiError`s). */
type ApiErrorOf<Entry extends ErrorEntry> = Entry extends ErrorEntry
  ? ApiError<Entry["code"] & string, Entry["details"]>
  : never;

/** Trailing `details` argument: omitted when the code has no `details`, optional
 * when the details type admits `undefined` or has no required props, else required. */
type DetailsArg<D> = [D] extends [undefined]
  ? []
  : undefined extends D
    ? [details?: Exclude<D, undefined>]
    : {} extends D
      ? [details?: D]
      : [details: D];

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Builds a typed `ApiError` for a declared error code. The status is taken from
 * the code's {@link ErrorDef}; the second argument sets the `Error.message`; the
 * optional third is the code's `details` payload. Uncallable when the contract
 * declares no errors (`Code` resolves to `never`).
 */
export type ErrorFactory<Entry extends ErrorEntry = never> =
  IsAny<Entry> extends true
    ? (code: any, message: string, ...details: any[]) => ApiError<any, any>
    : <Code extends Entry["code"]>(
        code: Code,
        message: string,
        ...details: DetailsArg<Extract<Entry, { code: Code }>["details"]>
      ) => ApiError<Code & string, Extract<Entry, { code: Code }>["details"]>;

/** Recognizes and narrows a caught error against the contract's declared errors. */
export type ErrorGuard<Entry extends ErrorEntry = never> =
  IsAny<Entry> extends true
    ? (err: unknown, code?: any) => err is ApiError<any, any>
    : {
        (err: unknown): err is [Entry] extends [never] ? ApiError : ApiErrorOf<Entry>;
        <Code extends [Entry] extends [never] ? string : Entry["code"]>(
          err: unknown,
          code: Code,
        ): err is [Entry] extends [never]
          ? ApiError<Code & string>
          : ApiError<Code & string, Extract<Entry, { code: Code }>["details"]>;
        <Code extends [Entry] extends [never] ? string : Entry["code"]>(
          err: unknown,
          codes: readonly Code[],
        ): err is [Entry] extends [never]
          ? ApiError<Code & string>
          : ApiErrorOf<Extract<Entry, { code: Code }>>;
      };

/**
 * A single resource: a set of endpoints under a base path, its declared errors,
 * and the typed `error`/`isError` helpers. Groups are composed into an {@link Api}
 * with {@link createApi}; the adapters, client, and OpenAPI consume the `Api`, not
 * a bare `Contract`.
 */
export interface Contract<
  C extends Record<string, Endpoint> = Record<string, Endpoint>,
  Entry extends ErrorEntry = never,
> {
  basePath: string;
  endpoints: C;
  errors?: ErrorMap;
  /** Constructs a typed `ApiError` from a declared error code; throw the result. */
  error: ErrorFactory<Entry>;
  /** Type guard for the contract's errors, with an optional `code` overload. */
  isError: ErrorGuard<Entry>;
  /** Phantom field carrying the error-entry union for inference; never set at runtime. */
  readonly __entry?: Entry;
}

export interface ContractOptions<
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
  M extends EndpointMeta | undefined = undefined,
> {
  errors?: E;
  /** Header schema merged into every route's own `headers` (route headers take precedence). */
  headers?: H;
  /** Default meta merged into every route's own `meta` (route meta takes precedence). */
  meta?: M;
}

/** Merges a contract-level header schema into a route's own header schema. */
export type MergeHeaders<
  Base extends TSchema | undefined,
  Route extends TSchema | undefined,
> = Base extends TSchema ? (Route extends TSchema ? TComposite<Base, Route> : Base) : Route;

/** Composes contract-level headers into every endpoint's `headers`. */
export type WithContractHeaders<
  C extends Record<string, any>,
  H extends TSchema | undefined,
> = H extends TSchema
  ? {
      [K in keyof C]: Endpoint &
        Omit<C[K], "headers"> & { headers: MergeHeaders<H, C[K]["headers"]> };
    }
  : C;

/** Composes contract-level headers into each endpoint at build time. */
export function applyContractHeaders(
  endpoints: Record<string, Endpoint>,
  headers: TSchema | undefined,
): Record<string, Endpoint> {
  if (!headers) return endpoints;
  return Object.fromEntries(
    Object.entries(endpoints).map(([name, endpoint]) => [
      name,
      { ...endpoint, headers: endpoint.headers ? T.Composite(headers, endpoint.headers) : headers },
    ]),
  );
}

/** A route's own declared meta, or `undefined` when it declares none. */
export type OwnMeta<E> = E extends { meta: infer O } ? O : undefined;

/** Merges a contract-level default meta into a route's own meta (route meta wins). */
export type MergeMeta<Base extends EndpointMeta, Route> = Route extends EndpointMeta
  ? Omit<Base, keyof Route> & Route
  : Base;

/** Composes a contract-level default meta into every endpoint's `meta`. */
export type WithContractMeta<
  C extends Record<string, any>,
  M extends EndpointMeta | undefined,
> = M extends EndpointMeta
  ? {
      [K in keyof C]: Omit<C[K], "meta"> & { meta: MergeMeta<M, OwnMeta<C[K]>> };
    }
  : C;

/** Composes a contract-level default meta into each endpoint at build time. */
export function applyContractMeta(
  endpoints: Record<string, Endpoint>,
  meta: EndpointMeta | undefined,
): Record<string, Endpoint> {
  if (!meta) return endpoints;
  return Object.fromEntries(
    Object.entries(endpoints).map(([name, endpoint]) => [
      name,
      { ...endpoint, meta: endpoint.meta ? { ...meta, ...endpoint.meta } : meta },
    ]),
  );
}

/**
 * Codes the framework emits for its own errors. They cannot be *declared* in a
 * contract's error map, but they ARE throwable via `contract.error` and matched
 * by `isError` (see {@link FrameworkEntries}). Statuses kept in sync here.
 */
export const FRAMEWORK_ERROR_STATUS = { VALIDATION_ERROR: 400, UNKNOWN_ERROR: 500 } as const;
export const RESERVED_ERROR_CODES = Object.keys(
  FRAMEWORK_ERROR_STATUS,
) as (keyof typeof FRAMEWORK_ERROR_STATUS)[];

function assertCodesAllowed(errors: ErrorMap): void {
  for (const code of Object.keys(errors)) {
    if ((RESERVED_ERROR_CODES as readonly string[]).includes(code)) {
      throw new Error(`Error code "${code}" is reserved by the framework`);
    }
  }
}

/**
 * Builds a standalone, typed error factory from an error map — the same factory
 * `contract.error` exposes, but usable anywhere (services, middleware) without a
 * contract. The status comes from the code's def; the framework codes
 * `VALIDATION_ERROR`/`UNKNOWN_ERROR` are always available. Pass the **same** map to
 * `createContract({ errors })` so the codes are declared and thus serialized
 * (rather than treated as unknown and collapsed into `UNKNOWN_ERROR`).
 */
export function makeErrorFactory<const E extends ErrorMap | undefined = undefined>(
  errors?: E,
): ErrorFactory<ContractEntries<E>> {
  if (errors) assertCodesAllowed(errors);
  const error = (code: string, message: string, details?: unknown): ApiError => {
    const status =
      errors?.[code]?.status ?? FRAMEWORK_ERROR_STATUS[code as keyof typeof FRAMEWORK_ERROR_STATUS];
    if (status === undefined) {
      throw new Error(`Unknown error code "${code}"`);
    }
    return new ApiError({ code, status, message, details });
  };
  return error as ErrorFactory<ContractEntries<E>>;
}

export function makeIsError(): (err: unknown, code?: string | readonly string[]) => boolean {
  return (err: unknown, code?: string | readonly string[]): boolean =>
    err instanceof ApiError &&
    (code === undefined ? true : Array.isArray(code) ? code.includes(err.code) : err.code === code);
}

export function buildContract(
  basePath: string,
  endpoints: Record<string, Endpoint>,
  errors: ErrorMap | undefined,
): Contract<any, any> {
  return {
    basePath,
    endpoints,
    errors,
    error: makeErrorFactory(errors),
    isError: makeIsError(),
  } as Contract<any, any>;
}

/**
 * Rejects properties outside `Shape` on `T` by mapping any unknown key to `never`.
 * Inferring an argument into a generic skips the excess-property check TypeScript
 * applies to a fixed annotation; wrapping the parameter in `Exact` reinstates it.
 */
export type Exact<T, Shape> = T & { [K in Exclude<keyof T, keyof Shape>]: never };

/**
 * Applies {@link Exact} to every endpoint literal in the map, so unknown endpoint
 * properties are rejected. A `meta` object's own sub-keys are unaffected — only the
 * endpoint's top-level keys are constrained.
 */
export type ExactEndpoints<C extends Record<string, Endpoint>> = {
  [K in keyof C]: Exact<C[K], Endpoint>;
};

export function createContract<const C extends Record<string, Endpoint>>(
  endpoints: ExactEndpoints<C>,
): Contract<C, FrameworkEntries>;
export function createContract<const C extends Record<string, Endpoint>>(
  basePath: string,
  endpoints: ExactEndpoints<C>,
): Contract<C, FrameworkEntries>;
export function createContract<
  const C extends Record<string, Endpoint>,
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
  const M extends EndpointMeta | undefined = undefined,
>(
  basePath: string,
  endpoints: ExactEndpoints<C>,
  options: ContractOptions<E, H, M>,
): Contract<WithContractMeta<WithContractHeaders<C, H>, M>, ContractEntries<E>>;
export function createContract(
  basePathOrEndpoints: string | Record<string, Endpoint>,
  endpointsOrOptions?: Record<string, Endpoint> | ContractOptions<any, any, any>,
  maybeOptions?: ContractOptions<any, any, any>,
): any {
  if (typeof basePathOrEndpoints === "string") {
    const endpoints = endpointsOrOptions as Record<string, Endpoint>;
    return buildContract(
      basePathOrEndpoints,
      applyContractMeta(applyContractHeaders(endpoints, maybeOptions?.headers), maybeOptions?.meta),
      maybeOptions?.errors,
    );
  }
  const options = endpointsOrOptions as ContractOptions<any, any, any> | undefined;
  return buildContract(
    "/",
    applyContractMeta(applyContractHeaders(basePathOrEndpoints, options?.headers), options?.meta),
    options?.errors,
  );
}

/** Anything endpoint-bearing — a {@link Contract} or an {@link Api}. */
export interface HasEndpoints {
  endpoints: Record<string, Endpoint>;
}

export type ContractSchema<C extends HasEndpoints> = {
  [E in keyof C["endpoints"]]: {
    body: InferSchema<C["endpoints"][E]["body"]>;
    response: InferSchema<C["endpoints"][E]["response"]>;
    params: InferSchema<C["endpoints"][E]["params"]>;
    query: InferSchema<C["endpoints"][E]["query"]>;
  };
};

export type ContractBody<C extends HasEndpoints> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["body"]>;
};

export type ContractResponse<C extends HasEndpoints> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["response"]>;
};

export type ContractParams<C extends HasEndpoints> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["params"]>;
};

export type ContractQuery<C extends HasEndpoints> = {
  [E in keyof C["endpoints"]]: InferSchema<C["endpoints"][E]["query"]>;
};
