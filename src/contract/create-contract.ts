import type { Static, TComposite, TSchema } from "typebox";
import * as T from "typebox";
import { ApiError } from "./api-error";

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

/** The `ApiError` type for an entry union (a discriminated union of `ApiError`s). */
type ApiErrorOf<Entry extends ErrorEntry> = Entry extends ErrorEntry
  ? ApiError<Entry["code"] & string, Entry["details"]>
  : never;

/** Trailing `details` argument: omitted when the code has no `details` schema,
 * optional when that schema has no required props, required otherwise. */
type DetailsArg<D> = [D] extends [undefined] ? [] : {} extends D ? [details?: D] : [details: D];

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Builds a typed `ApiError` for a declared error code. The status is taken from
 * the code's {@link ErrorDef}; the second argument sets the `Error.message`; the
 * optional third is the code's `details` payload. Uncallable when the contract
 * declares no errors (`Code` resolves to `never`).
 */
export type ErrorFactory<Entry extends ErrorEntry = never> = <Code extends Entry["code"]>(
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
      };

export interface Contract<
  C extends Record<string, Endpoint> = Record<string, Endpoint>,
  Entry extends ErrorEntry = never,
  N extends Record<string, Contract<any, any>> | undefined = undefined,
> {
  basePath: string;
  endpoints: C;
  errors?: ErrorMap;
  named?: N;
  /** Phantom field carrying the error-entry union for inference; never set at runtime. */
  readonly __entry?: Entry;
}

/** The error helpers attached to a contract: a typed factory and guard. */
export interface ContractApi<Entry extends ErrorEntry = never> {
  /** Constructs a typed `ApiError` from a declared error code; throw the result. */
  error: ErrorFactory<Entry>;
  /** Type guard for the contract's errors, with an optional `code` overload. */
  isError: ErrorGuard<Entry>;
}

/** A contract together with its `error`/`isError` helpers (the shape `createContract` returns). */
export type ContractWithApi<
  C extends Record<string, Endpoint> = Record<string, Endpoint>,
  Entry extends ErrorEntry = never,
  N extends Record<string, Contract<any, any>> | undefined = undefined,
> = Contract<C, Entry, N> & ContractApi<Entry>;

export interface ContractOptions<
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
> {
  errors?: E;
  /** Header schema merged into every route's own `headers` (route headers take precedence). */
  headers?: H;
}

/** Merges a contract-level header schema into a route's own header schema. */
export type MergeHeaders<
  Base extends TSchema | undefined,
  Route extends TSchema | undefined,
> = Base extends TSchema ? (Route extends TSchema ? TComposite<Base, Route> : Base) : Route;

/** Composes contract-level headers into every endpoint's `headers`. */
export type WithContractHeaders<
  C extends Record<string, Endpoint>,
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

/** Codes the framework emits for its own errors; they cannot be declared by a contract. */
export const RESERVED_ERROR_CODES = ["VALIDATION_ERROR", "UNKNOWN_ERROR"] as const;

function assertCodesAllowed(errors: ErrorMap): void {
  for (const code of Object.keys(errors)) {
    if ((RESERVED_ERROR_CODES as readonly string[]).includes(code)) {
      throw new Error(`Error code "${code}" is reserved by the framework`);
    }
  }
}

export function buildContract(
  basePath: string,
  endpoints: Record<string, Endpoint>,
  errors: ErrorMap | undefined,
  named?: Record<string, Contract<any, any>>,
): ContractWithApi<any, any, any> {
  if (errors) assertCodesAllowed(errors);

  const error = (code: string, message: string, details?: unknown): ApiError => {
    const def = errors?.[code];
    if (!def) {
      throw new Error(`Unknown error code "${code}"`);
    }
    return new ApiError({ code, status: def.status, message, details });
  };

  const isError = (err: unknown, code?: string): boolean =>
    err instanceof ApiError && (code === undefined || err.code === code);

  return { basePath, endpoints, errors, named, error, isError } as ContractWithApi<any, any, any>;
}

export function createContract<const C extends Record<string, Endpoint>>(
  endpoints: C,
): ContractWithApi<C>;
export function createContract<
  const C extends Record<string, Endpoint>,
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
>(
  endpoints: C,
  options: ContractOptions<E, H>,
): ContractWithApi<WithContractHeaders<C, H>, EntriesOf<E>>;
export function createContract<const C extends Record<string, Endpoint>>(
  basePath: string,
  endpoints: C,
): ContractWithApi<C>;
export function createContract<
  const C extends Record<string, Endpoint>,
  E extends ErrorMap | undefined = undefined,
  H extends TSchema | undefined = undefined,
>(
  basePath: string,
  endpoints: C,
  options: ContractOptions<E, H>,
): ContractWithApi<WithContractHeaders<C, H>, EntriesOf<E>>;
export function createContract(
  basePathOrEndpoints: string | Record<string, Endpoint>,
  endpointsOrOptions?: Record<string, Endpoint> | ContractOptions<any, any>,
  maybeOptions?: ContractOptions<any, any>,
): any {
  if (typeof basePathOrEndpoints === "string") {
    const endpoints = endpointsOrOptions as Record<string, Endpoint>;
    return buildContract(
      basePathOrEndpoints,
      applyContractHeaders(endpoints, maybeOptions?.headers),
      maybeOptions?.errors,
    );
  }
  const options = endpointsOrOptions as ContractOptions<any, any> | undefined;
  return buildContract(
    "/",
    applyContractHeaders(basePathOrEndpoints, options?.headers),
    options?.errors,
  );
}

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
