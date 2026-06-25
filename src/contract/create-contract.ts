import type { Static, TSchema } from "typebox";
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
  description?: string;
} & MetaField<EndpointMeta>;

/** Maps an HTTP status code to the body schema (or union of schemas) returned at that status. */
export type ErrorMap = Record<number, TSchema>;

/** A single (status, code, body) error variant derived from an {@link ErrorMap}. */
export interface ErrorEntry {
  status: number;
  code: string;
  body: unknown;
}

/** Flattens an {@link ErrorMap} into the union of its (status, code, body) variants. */
export type EntriesOf<E extends ErrorMap | undefined> = E extends ErrorMap
  ? {
      [S in Extract<keyof E, number>]: Static<E[S]> extends infer B
        ? B extends { code: infer Code extends string }
          ? { status: S; code: Code; body: B }
          : never
        : never;
    }[Extract<keyof E, number>]
  : never;

type RestArg<X> = keyof X extends never ? [] : {} extends X ? [extra?: X] : [extra: X];

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Builds a typed `ApiError` for a declared error code, inferring its status.
 * Uncallable when the contract declares no errors (`Code` resolves to `never`).
 */
export type ErrorFactory<Entry extends ErrorEntry = never> = <Code extends Entry["code"]>(
  code: Code,
  ...rest: RestArg<Omit<Extract<Entry, { code: Code }>["body"], "code">>
) => ApiError<Extract<Entry, { code: Code }>["body"]>;

/** Recognizes and narrows a caught error against the contract's declared errors. */
export type ErrorGuard<Entry extends ErrorEntry = never> =
  IsAny<Entry> extends true
    ? (err: unknown, code?: any) => err is ApiError<any>
    : {
        (err: unknown): err is ApiError<[Entry] extends [never] ? unknown : Entry["body"]>;
        <Code extends [Entry] extends [never] ? string : Entry["code"]>(
          err: unknown,
          code: Code,
        ): err is ApiError<
          [Entry] extends [never]
            ? { code: Code } & Record<string, unknown>
            : Extract<Entry, { code: Code }>["body"]
        >;
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

export interface ContractOptions<E extends ErrorMap | undefined = undefined> {
  errors?: E;
}

function schemaMembers(schema: TSchema): TSchema[] {
  const anyOf = (schema as { anyOf?: TSchema[] }).anyOf;
  return Array.isArray(anyOf) ? anyOf : [schema];
}

/** Codes the framework emits for its own errors; they cannot be declared by a contract. */
export const RESERVED_ERROR_CODES = ["VALIDATION_ERROR", "UNKNOWN_ERROR"] as const;

function buildCodeStatusTable(errors: ErrorMap): Record<string, number> {
  const table: Record<string, number> = {};
  for (const [statusStr, schema] of Object.entries(errors)) {
    const status = Number(statusStr);
    for (const member of schemaMembers(schema)) {
      const code = (member as { properties?: { code?: { const?: unknown } } }).properties?.code
        ?.const;
      if (typeof code === "string") {
        if ((RESERVED_ERROR_CODES as readonly string[]).includes(code)) {
          throw new Error(`Error code "${code}" is reserved by the framework`);
        }
        if (code in table) {
          throw new Error(`Duplicate error code "${code}" in contract errors`);
        }
        table[code] = status;
      }
    }
  }
  return table;
}

export function buildContract(
  basePath: string,
  endpoints: Record<string, Endpoint>,
  errors: ErrorMap | undefined,
  named?: Record<string, Contract<any, any>>,
): ContractWithApi<any, any, any> {
  const codeToStatus = errors ? buildCodeStatusTable(errors) : {};

  const error = (code: string, extra?: Record<string, unknown>): ApiError => {
    const status = codeToStatus[code];
    if (status === undefined) {
      throw new Error(`Unknown error code "${code}"`);
    }
    return new ApiError(status, { code, ...extra });
  };

  const isError = (err: unknown, code?: string): boolean =>
    err instanceof ApiError &&
    (code === undefined || (err.body as { code?: unknown } | null | undefined)?.code === code);

  return { basePath, endpoints, errors, named, error, isError } as ContractWithApi<any, any, any>;
}

export function createContract<const C extends Record<string, Endpoint>>(
  endpoints: C,
): ContractWithApi<C>;
export function createContract<
  const C extends Record<string, Endpoint>,
  E extends ErrorMap | undefined = undefined,
>(endpoints: C, options: ContractOptions<E>): ContractWithApi<C, EntriesOf<E>>;
export function createContract<const C extends Record<string, Endpoint>>(
  basePath: string,
  endpoints: C,
): ContractWithApi<C>;
export function createContract<
  const C extends Record<string, Endpoint>,
  E extends ErrorMap | undefined = undefined,
>(basePath: string, endpoints: C, options: ContractOptions<E>): ContractWithApi<C, EntriesOf<E>>;
export function createContract(
  basePathOrEndpoints: string | Record<string, Endpoint>,
  endpointsOrOptions?: Record<string, Endpoint> | ContractOptions<any>,
  maybeOptions?: ContractOptions<any>,
): any {
  if (typeof basePathOrEndpoints === "string") {
    return buildContract(
      basePathOrEndpoints,
      endpointsOrOptions as Record<string, Endpoint>,
      maybeOptions?.errors,
    );
  }
  return buildContract(
    "/",
    basePathOrEndpoints,
    (endpointsOrOptions as ContractOptions<any> | undefined)?.errors,
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
