import type { Contract, Endpoint, ErrorMap, InferSchema, ValidationIssue } from "../../contract";
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

export interface ImplementContractOptions<HonoEnv extends Env = Env> {
  validateResponse?: boolean;
  middleware?: EndpointMiddlewareFactory<HonoEnv>;
}

export interface CreateHonoAppOptions<HonoEnv extends Env = Env> {
  /**
   * Handle an error the framework didn't already serialize as a recognized contract
   * error. A **known-code** `ApiError` — a code declared in a contract, or a built-in
   * `VALIDATION_ERROR`/`UNKNOWN_ERROR` — is serialized automatically and never reaches
   * `onError`; everything else does: plain exceptions, Hono `HTTPException`s, and
   * `ApiError`s with an unrecognized code. Return an `ApiError` to shape the response,
   * or nothing for the default — an `HTTPException` keeps its own status, anything
   * else becomes a 500 `UNKNOWN_ERROR`. The server can never emit a non-`ApiError`
   * body, regardless of what this does.
   */
  onError?: (err: unknown, c: Context<HonoEnv>) => ApiError | void | Promise<ApiError | void>;
  middleware?: EndpointMiddlewareFactory<HonoEnv> | EndpointMiddlewareFactory<HonoEnv>[];
}

export interface RouteModule {
  _hono: Hono;
  _basePath: string;
  _endpoints: Record<string, Endpoint>;
  /** Error codes declared by this module's contract (for the known-code check). */
  _errorCodes: Set<string>;
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

function buildModule(
  endpoints: Record<string, Endpoint>,
  handlers: Record<string, any>,
  perHandlerOptions: Record<string, HandlerOptions | undefined>,
  errors: ErrorMap | undefined,
  mountPath: string,
  moduleOptions: ImplementContractOptions,
  groupMiddlewares: MiddlewareHandler[],
): RouteModule {
  const missing = Object.keys(endpoints).filter((name) => !(name in handlers));
  if (missing.length > 0) {
    throw new Error(`Missing handlers for endpoints: ${missing.join(", ")}`);
  }

  const sorted = Object.entries(endpoints).sort(([, a], [, b]) =>
    compareSpecificity(a.path, b.path),
  );

  const buildHono = (globalFactory?: EndpointMiddlewareFactory): Hono => {
    const hono = new Hono();

    for (const [name, endpoint] of sorted) {
      const handler = handlers[name];
      const handlerOptions = perHandlerOptions[name];

      const preMw = globalFactory ? toMiddlewareArray(globalFactory(endpoint)) : [];
      const contractMw = toMiddlewareArray(moduleOptions.middleware?.(endpoint));
      const allMw = [...preMw, ...groupMiddlewares, ...contractMw];

      hono.on(endpoint.method, [endpoint.path], ...allMw, async (c: Context) => {
        const input: Record<string, unknown> = { c };

        // All framework errors share the contract's error envelope; VALIDATION_ERROR's
        // details is the normalized `{ path?, message }[]` array of issues.
        const validationError = (issues: ValidationIssue[]) =>
          c.json(errorEnvelope("VALIDATION_ERROR", 400, "Validation failed", issues), 400);

        if (endpoint.params) {
          try {
            input.params = parseParams(endpoint.params, c.req.param());
          } catch (error) {
            if (error instanceof AssertError) {
              return validationError(normalizeIssues(error.cause.errors));
            }
            throw error;
          }
        }

        if (endpoint.query) {
          try {
            input.query = parseQuery(endpoint.query, c.req.queries() as Record<string, string[]>);
          } catch (error) {
            if (error instanceof AssertError) {
              return validationError(normalizeIssues(error.cause.errors));
            }
            if (error instanceof QueryNormalizationError) {
              return validationError([{ message: error.message }]);
            }
            throw error;
          }
        }

        if (endpoint.headers) {
          try {
            input.headers = parseHeaders(endpoint.headers, c.req.header());
          } catch (error) {
            if (error instanceof AssertError) {
              return validationError(normalizeIssues(error.cause.errors));
            }
            throw error;
          }
        }

        if (endpoint.body) {
          try {
            input.body = parseBody(endpoint.body, await c.req.json());
          } catch (error) {
            if (error instanceof AssertError) {
              return validationError(normalizeIssues(error.cause.errors));
            }
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
          // Only a code declared by THIS contract is serialized here (with details
          // validation). Framework codes and unrecognized codes bubble to root.onError,
          // which serializes known codes and routes the rest to onError.
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

        if (result instanceof Response) {
          return result;
        }

        const successCode = endpoint.responseCode ?? 200;

        if (shouldValidate && endpoint.response) {
          // parseResponse throws ResponseValidationError on a mismatch; it bubbles to onError,
          // which surfaces it to the client as UNKNOWN_ERROR (without leaking why).
          return c.json(parseResponse(endpoint.response, result) as any, successCode as any);
        }

        return c.json(result as any, successCode as any);
      });
    }

    return hono;
  };

  return {
    _hono: buildHono(),
    _basePath: mountPath,
    _endpoints: endpoints,
    _errorCodes: new Set(Object.keys(errors ?? {})),
    _rebuild: buildHono,
  };
}

// Named group, object handlers or closure
export function implementContract<
  C extends Record<string, Endpoint>,
  N extends Record<string, Contract<any, any>>,
  K extends keyof N & string,
  HonoEnv extends Env = Env,
>(
  contract: Contract<C, any, N>,
  groupName: K,
  handlersOrClosure:
    | HandlerMap<N[K]["endpoints"], HonoEnv>
    | ((group: GroupBuilder<N[K]["endpoints"], HonoEnv>) => void),
  options?: ImplementContractOptions<HonoEnv>,
): RouteModule;

// Unnamed, object handlers or closure
export function implementContract<C extends Record<string, Endpoint>, HonoEnv extends Env = Env>(
  contract: Contract<C, any, any>,
  handlersOrClosure: HandlerMap<C, HonoEnv> | ((group: GroupBuilder<C, HonoEnv>) => void),
  options?: ImplementContractOptions<HonoEnv>,
): RouteModule;

export function implementContract(
  contract: Contract<any, any, any>,
  arg2: string | Record<string, any> | ((group: any) => void),
  arg3?: Record<string, any> | ((group: any) => void) | ImplementContractOptions,
  arg4?: ImplementContractOptions,
): RouteModule {
  const handlers: Record<string, any> = {};
  const perHandlerOptions: Record<string, HandlerOptions | undefined> = {};
  const groupMiddlewares: MiddlewareHandler[] = [];

  let endpoints: Record<string, Endpoint>;
  let mountPath: string;
  let options: ImplementContractOptions;
  let handlersOrClosure: Record<string, any> | ((group: any) => void);

  if (typeof arg2 === "string") {
    const groupName = arg2;
    if (!contract.named?.[groupName]) {
      throw new Error(`No named group "${groupName}" found in contract`);
    }
    const groupContract = contract.named[groupName] as Contract<any, any>;
    endpoints = groupContract.endpoints;
    mountPath = normalizeMountPath(joinPath(contract.basePath, groupContract.basePath));
    handlersOrClosure = arg3 as Record<string, any> | ((group: any) => void);
    options = arg4 ?? {};
  } else {
    endpoints = contract.endpoints;
    mountPath = normalizeMountPath(contract.basePath);
    handlersOrClosure = arg2;
    options = (arg3 as ImplementContractOptions | undefined) ?? {};
  }

  if (typeof handlersOrClosure === "function") {
    const group: GroupBuilder<any> = {
      use(middleware: MiddlewareHandler) {
        groupMiddlewares.push(middleware);
      },
      implement(name: string, handler: any, handlerOptions?: HandlerOptions) {
        handlers[name] = handler;
        if (handlerOptions) perHandlerOptions[name] = handlerOptions;
      },
    };
    handlersOrClosure(group);
  } else {
    Object.assign(handlers, handlersOrClosure);
  }

  return buildModule(
    endpoints,
    handlers,
    perHandlerOptions,
    contract.errors,
    mountPath,
    options,
    groupMiddlewares,
  );
}

export function createHonoApp<HonoEnv extends Env = Env>(
  modules: RouteModule[],
  options?: CreateHonoAppOptions<HonoEnv>,
): Hono<HonoEnv> {
  const root = new Hono<HonoEnv>();

  // Codes that are "known": the framework's built-ins plus every code declared by
  // any module's contract. A thrown ApiError with a known code is serialized as-is
  // (wherever it was thrown); anything else is "unknown" and routed to the hook.
  const knownCodes = new Set<string>(RESERVED_ERROR_CODES);
  for (const module of modules) {
    for (const code of module._errorCodes) knownCodes.add(code);
  }

  const onError = options?.onError;
  root.onError(async (err, c) => {
    // A known-code ApiError is a recognized, deliberate contract error — serialize
    // it as-is. Covers ApiErrors thrown anywhere that bypass the per-route catch
    // (middleware, services) and framework codes a handler rethrows.
    if (err instanceof ApiError && knownCodes.has(err.code)) {
      return c.json(
        errorEnvelope(err.code, err.status, err.message, err.details) as any,
        err.status as any,
      );
    }
    // Everything else is unknown: a non-ApiError, or an ApiError with an
    // unrecognized code. Let the hook map it to a typed error.
    if (onError) {
      try {
        const mapped = await onError(err, c);
        if (mapped instanceof ApiError) {
          return c.json(
            errorEnvelope(mapped.code, mapped.status, mapped.message, mapped.details) as any,
            mapped.status as any,
          );
        }
      } catch (hookError) {
        console.error(hookError);
      }
    }
    // Preserve Hono's own error handling: an HTTPException (from the framework or
    // middleware such as bearer auth) keeps its status and response instead of
    // collapsing into UNKNOWN_ERROR. The client surfaces it as a non-handshake
    // HttpError. Installing this onError otherwise replaces Hono's default, which
    // would turn an expected 401/403/404 into a 500.
    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    return c.json(errorEnvelope("UNKNOWN_ERROR", 500, "Unknown error", undefined), 500);
  });

  const middlewareFactories = options?.middleware
    ? Array.isArray(options.middleware)
      ? options.middleware
      : [options.middleware]
    : [];

  const globalFactory: EndpointMiddlewareFactory | undefined =
    middlewareFactories.length > 0
      ? (endpoint) => middlewareFactories.flatMap((f) => toMiddlewareArray(f(endpoint)))
      : undefined;

  for (const module of modules) {
    const hono = globalFactory ? module._rebuild(globalFactory) : module._hono;
    root.route(module._basePath || "/", hono);
  }

  return root;
}
