import type { Api, Contract, Endpoint, InferSchema, ValidationIssue } from "../../contract";
import { ApiError, RESERVED_ERROR_CODES, errorEnvelope, joinPath } from "../../contract";
import {
  AssertError,
  type BaseHandlerInput,
  type HandlerOptions,
  QueryNormalizationError,
  normalizeIssues,
  parseBody,
  parseHeaders,
  parseParams,
  parseQuery,
  parseResponse,
} from "../../server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Context, Env, MiddlewareHandler } from "hono";

type HandlerInput<E extends Endpoint, HonoEnv extends Env> = BaseHandlerInput<E> & {
  c: Context<HonoEnv>;
};

type Handler<E extends Endpoint, HonoEnv extends Env = Env> = (
  input: HandlerInput<E, HonoEnv>,
) => InferSchema<E["response"]> | Response | Promise<InferSchema<E["response"]> | Response>;

type HandlerMap<E extends Record<string, Endpoint>, HonoEnv extends Env = Env> = {
  [K in keyof E]: Handler<E[K], HonoEnv>;
};

export type EndpointMiddlewareFactory<HonoEnv extends Env = Env> = (
  endpoint: Endpoint,
) => MiddlewareHandler<HonoEnv> | MiddlewareHandler<HonoEnv>[] | undefined;

export interface GroupBuilder<E extends Record<string, Endpoint>, HonoEnv extends Env = Env> {
  use(middleware: MiddlewareHandler<HonoEnv>): void;
  implement<K extends keyof E & string>(
    name: K,
    handler: Handler<E[K], HonoEnv>,
    options?: HandlerOptions,
  ): void;
}

export interface BuildRoutesOptions<HonoEnv extends Env = Env> {
  validateResponse?: boolean;
  middleware?: EndpointMiddlewareFactory<HonoEnv>;
}

export interface CreateHonoAppOptions<HonoEnv extends Env = Env> {
  /**
   * The built routes to mount — an array of {@link buildRoutes} results, or an eager
   * `import.meta.glob(..., { eager: true })` module-record (every `Routes`-branded
   * export is collected and deduped by identity).
   */
  routes: Routes[] | Record<string, unknown>;
  /**
   * Handle an error the framework didn't already serialize as a recognized contract
   * error. A **known-code** `ApiError` — a code declared by the api, or a built-in
   * `VALIDATION_ERROR`/`UNKNOWN_ERROR` — is serialized automatically and never reaches
   * `onError`; everything else does: plain exceptions, Hono `HTTPException`s, and
   * `ApiError`s with an unrecognized code. Return an `ApiError` to shape the response,
   * or nothing for the default — an `HTTPException` keeps its own status, anything
   * else becomes a 500 `UNKNOWN_ERROR`.
   */
  onError?: (err: unknown, c: Context<HonoEnv>) => ApiError | void | Promise<ApiError | void>;
  middleware?: EndpointMiddlewareFactory<HonoEnv> | EndpointMiddlewareFactory<HonoEnv>[];
}

const ROUTES_BRAND = "handshake.routes";

/** A bundle of implemented routes for one api, produced by {@link buildRoutes} and
 *  consumed by {@link createHonoApp}. Opaque — its shape is an implementation detail. */
export interface Routes {
  readonly __brand: typeof ROUTES_BRAND;
  _api: Api<any, any>;
  _hono: Hono;
  _basePath: string;
  /** Error codes recognized by the api (for the known-code check). */
  _errorCodes: Set<string>;
  /** The endpoints this bundle implemented, with resolved method + full path. */
  _implemented: { name: string; method: string; path: string }[];
  _rebuild: (globalFactory: EndpointMiddlewareFactory) => Hono;
}

function compareSpecificity(a: string, b: string): number {
  const aSegs = a.split("/");
  const bSegs = b.split("/");
  const max = Math.max(aSegs.length, bSegs.length);
  for (let i = 0; i < max; i++) {
    const aSeg = aSegs[i];
    const bSeg = bSegs[i];
    if (aSeg === bSeg) continue;
    if (aSeg === undefined) return -1;
    if (bSeg === undefined) return 1;
    const aParam = aSeg.startsWith(":");
    const bParam = bSeg.startsWith(":");
    if (aParam !== bParam) return aParam ? 1 : -1;
    return 0;
  }
  return 0;
}

function normalizeMountPath(basePath: string): string {
  return basePath === "/" ? "" : basePath;
}

function toMiddlewareArray(
  value: MiddlewareHandler | MiddlewareHandler[] | undefined,
): MiddlewareHandler[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

interface BuildModuleParams {
  api: Api<any, any>;
  /** Candidate endpoint defs (a group's for the named form, the flat api set for unnamed). */
  endpoints: Record<string, Endpoint>;
  handlers: Record<string, any>;
  perHandlerOptions: Record<string, HandlerOptions | undefined>;
  mountPath: string;
  /** When true, every candidate endpoint must have a handler (the named-contract form). */
  requireComplete: boolean;
  moduleOptions: BuildRoutesOptions;
  groupMiddlewares: MiddlewareHandler[];
}

function buildModule(params: BuildModuleParams): Routes {
  const { api, endpoints, handlers, perHandlerOptions, mountPath, requireComplete, moduleOptions } =
    params;
  const errors = api.errors;

  // Every handler must target a real endpoint (catches typos + wrong-api handlers).
  const unknown = Object.keys(handlers).filter((name) => !(name in endpoints));
  if (unknown.length > 0) {
    throw new Error(`Unknown endpoint(s): ${unknown.join(", ")}`);
  }
  if (requireComplete) {
    const missing = Object.keys(endpoints).filter((name) => !(name in handlers));
    if (missing.length > 0) {
      throw new Error(`Missing handlers for endpoints: ${missing.join(", ")}`);
    }
  }

  const handled = Object.entries(endpoints)
    .filter(([name]) => name in handlers)
    .sort(([, a], [, b]) => compareSpecificity(a.path, b.path));

  const buildHono = (globalFactory?: EndpointMiddlewareFactory): Hono => {
    const hono = new Hono();

    for (const [name, endpoint] of handled) {
      const handler = handlers[name];
      const handlerOptions = perHandlerOptions[name];

      const preMw = globalFactory ? toMiddlewareArray(globalFactory(endpoint)) : [];
      const contractMw = toMiddlewareArray(moduleOptions.middleware?.(endpoint));
      const allMw = [...preMw, ...params.groupMiddlewares, ...contractMw];

      hono.on(endpoint.method, [endpoint.path], ...allMw, async (c: Context) => {
        const input: Record<string, unknown> = { c };

        const validationError = (issues: ValidationIssue[]) =>
          c.json(errorEnvelope("VALIDATION_ERROR", 400, "Validation failed", issues), 400);

        if (endpoint.params) {
          try {
            input.params = parseParams(endpoint.params, c.req.param());
          } catch (error) {
            if (error instanceof AssertError)
              return validationError(normalizeIssues(error.cause.errors));
            throw error;
          }
        }

        if (endpoint.query) {
          try {
            input.query = parseQuery(endpoint.query, c.req.queries() as Record<string, string[]>);
          } catch (error) {
            if (error instanceof AssertError)
              return validationError(normalizeIssues(error.cause.errors));
            if (error instanceof QueryNormalizationError)
              return validationError([{ message: error.message }]);
            throw error;
          }
        }

        if (endpoint.headers) {
          try {
            input.headers = parseHeaders(endpoint.headers, c.req.header());
          } catch (error) {
            if (error instanceof AssertError)
              return validationError(normalizeIssues(error.cause.errors));
            throw error;
          }
        }

        if (endpoint.body) {
          try {
            input.body = parseBody(endpoint.body, await c.req.json());
          } catch (error) {
            if (error instanceof AssertError)
              return validationError(normalizeIssues(error.cause.errors));
            throw error;
          }
        }

        const shouldValidate =
          handlerOptions?.validateResponse ?? moduleOptions.validateResponse ?? true;

        let result: unknown;
        try {
          result = await handler(input as any);
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          // A code declared by the api is serialized here (with details validation).
          // Framework/unknown codes bubble to root.onError.
          const def = errors?.[err.code];
          if (!def) throw err;
          const emit = (details: unknown) =>
            c.json(
              errorEnvelope(err.code, err.status, err.message, details) as any,
              err.status as any,
            );
          if (shouldValidate && def.details) {
            try {
              return emit(parseResponse(def.details, err.details));
            } catch (validationError) {
              if (validationError instanceof AssertError) throw err;
              throw validationError;
            }
          }
          return emit(err.details);
        }

        if (result instanceof Response) return result;

        const successCode = endpoint.responseCode ?? 200;
        if (shouldValidate && endpoint.response) {
          return c.json(parseResponse(endpoint.response, result) as any, successCode as any);
        }
        return c.json(result as any, successCode as any);
      });
    }

    return hono;
  };

  return {
    __brand: ROUTES_BRAND,
    _api: api,
    _hono: buildHono(),
    _basePath: mountPath,
    _errorCodes: new Set(Object.keys(errors ?? {})),
    _implemented: handled.map(([name, endpoint]) => ({
      name,
      method: endpoint.method,
      path: joinPath(mountPath, endpoint.path),
    })),
    _rebuild: buildHono,
  };
}

function collectHandlers(handlersOrClosure: Record<string, any> | ((group: any) => void)): {
  handlers: Record<string, any>;
  perHandlerOptions: Record<string, HandlerOptions | undefined>;
  groupMiddlewares: MiddlewareHandler[];
} {
  const handlers: Record<string, any> = {};
  const perHandlerOptions: Record<string, HandlerOptions | undefined> = {};
  const groupMiddlewares: MiddlewareHandler[] = [];

  if (typeof handlersOrClosure === "function") {
    const group: GroupBuilder<any> = {
      use(middleware: MiddlewareHandler) {
        groupMiddlewares.push(middleware);
      },
      implement(name: string, handler: any, handlerOptions?: HandlerOptions) {
        if (name in handlers) {
          throw new Error(`Endpoint "${name}" implemented more than once`);
        }
        handlers[name] = handler;
        if (handlerOptions) perHandlerOptions[name] = handlerOptions;
      },
    };
    handlersOrClosure(group);
  } else {
    Object.assign(handlers, handlersOrClosure);
  }

  return { handlers, perHandlerOptions, groupMiddlewares };
}

// (a) named — implement the whole contract (object form is compile-time complete).
export function buildRoutes<
  G extends Record<string, Contract<any, any>>,
  K extends keyof G & string,
  HonoEnv extends Env = Env,
>(
  api: Api<G, any>,
  contractName: K,
  handlers:
    | HandlerMap<G[K]["endpoints"], HonoEnv>
    | ((group: GroupBuilder<G[K]["endpoints"], HonoEnv>) => void),
  options?: BuildRoutesOptions<HonoEnv>,
): Routes;
// (b) unnamed escape hatch — any subset of the api's endpoints (completeness at createHonoApp).
export function buildRoutes<A extends Api<any, any>, HonoEnv extends Env = Env>(
  api: A,
  handlers:
    | Partial<HandlerMap<A["endpoints"], HonoEnv>>
    | ((group: GroupBuilder<A["endpoints"], HonoEnv>) => void),
  options?: BuildRoutesOptions<HonoEnv>,
): Routes;
export function buildRoutes(
  api: Api<any, any>,
  arg2: string | Record<string, any> | ((group: any) => void),
  arg3?: Record<string, any> | ((group: any) => void) | BuildRoutesOptions,
  arg4?: BuildRoutesOptions,
): Routes {
  let endpoints: Record<string, Endpoint>;
  let mountPath: string;
  let requireComplete: boolean;
  let handlersOrClosure: Record<string, any> | ((group: any) => void);
  let options: BuildRoutesOptions;

  if (typeof arg2 === "string") {
    const group = (api.contracts as Record<string, Contract<any, any>>)[arg2];
    if (!group) {
      throw new Error(`No contract "${arg2}" in this api`);
    }
    endpoints = group.endpoints as Record<string, Endpoint>;
    mountPath = normalizeMountPath(joinPath(api.basePath, group.basePath));
    requireComplete = true;
    handlersOrClosure = arg3 as Record<string, any> | ((group: any) => void);
    options = arg4 ?? {};
  } else {
    endpoints = api.endpoints as Record<string, Endpoint>;
    mountPath = normalizeMountPath(api.basePath);
    requireComplete = false;
    handlersOrClosure = arg2;
    options = (arg3 as BuildRoutesOptions | undefined) ?? {};
  }

  const { handlers, perHandlerOptions, groupMiddlewares } = collectHandlers(handlersOrClosure);

  return buildModule({
    api,
    endpoints,
    handlers,
    perHandlerOptions,
    mountPath,
    requireComplete,
    moduleOptions: options,
    groupMiddlewares,
  });
}

function isRoutes(value: unknown): value is Routes {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __brand?: unknown }).__brand === ROUTES_BRAND
  );
}

/** Normalizes the `routes` option: an array, or a glob module-record whose exports
 *  are scanned for `Routes`-branded values. Deduped by identity. */
function collectRoutes(routes: Routes[] | Record<string, unknown>): Routes[] {
  const found = new Set<Routes>();
  const consider = (value: unknown): void => {
    if (isRoutes(value)) {
      found.add(value);
    } else if (value && typeof value === "object") {
      for (const inner of Object.values(value)) if (isRoutes(inner)) found.add(inner);
    }
  };
  if (Array.isArray(routes)) {
    for (const r of routes) consider(r);
  } else {
    for (const mod of Object.values(routes)) consider(mod);
  }
  return [...found];
}

/** Asserts, per api: completeness (every endpoint implemented), no double-implement,
 *  and no (method, path) route conflict across all collected routes. */
function assertCoverage(routes: Routes[]): void {
  const byApi = new Map<Api<any, any>, Routes[]>();
  for (const r of routes) {
    const list = byApi.get(r._api) ?? [];
    list.push(r);
    byApi.set(r._api, list);
  }

  const seenPath = new Map<string, string>();
  for (const [api, apiRoutes] of byApi) {
    const implementedBy = new Set<string>();
    for (const r of apiRoutes) {
      for (const impl of r._implemented) {
        if (implementedBy.has(impl.name)) {
          throw new Error(`Endpoint "${impl.name}" is implemented more than once`);
        }
        implementedBy.add(impl.name);
        const key = `${impl.method} ${impl.path}`;
        const prev = seenPath.get(key);
        if (prev) {
          throw new Error(`Route conflict: ${key} implemented by "${prev}" and "${impl.name}"`);
        }
        seenPath.set(key, impl.name);
      }
    }
    const missing = Object.keys(api.endpoints as Record<string, Endpoint>).filter(
      (name) => !implementedBy.has(name),
    );
    if (missing.length > 0) {
      throw new Error(
        `Api at "${api.basePath}" is missing implementations for: ${missing.join(", ")}`,
      );
    }
  }
}

export function createHonoApp<HonoEnv extends Env = Env>(
  options: CreateHonoAppOptions<HonoEnv>,
): Hono<HonoEnv> {
  const routes = collectRoutes(options.routes);
  assertCoverage(routes);

  const root = new Hono<HonoEnv>();

  const knownCodes = new Set<string>(RESERVED_ERROR_CODES);
  for (const r of routes) {
    for (const code of r._errorCodes) knownCodes.add(code);
  }

  const onError = options.onError;
  root.onError(async (err, c) => {
    if (err instanceof ApiError && knownCodes.has(err.code)) {
      return c.json(
        errorEnvelope(err.code, err.status, err.message, err.details) as any,
        err.status as any,
      );
    }
    if (onError) {
      try {
        const mapped = await onError(err, c);
        if (mapped instanceof ApiError) {
          return c.json(
            errorEnvelope(mapped.code, mapped.status, mapped.message, mapped.details) as any,
            mapped.status as any,
          );
        }
      } catch {
        // A throwing onError still yields a safe response — fall through.
      }
    }
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    return c.json(errorEnvelope("UNKNOWN_ERROR", 500, "Unknown error", undefined), 500);
  });

  const middlewareFactories = options.middleware
    ? Array.isArray(options.middleware)
      ? options.middleware
      : [options.middleware]
    : [];

  const globalFactory: EndpointMiddlewareFactory | undefined =
    middlewareFactories.length > 0
      ? (endpoint) => middlewareFactories.flatMap((f) => toMiddlewareArray(f(endpoint)))
      : undefined;

  for (const r of routes) {
    const hono = globalFactory ? r._rebuild(globalFactory) : r._hono;
    root.route(r._basePath || "/", hono);
  }

  return root;
}
