import type { Contract, Endpoint, ErrorMap, InferSchema } from "../../contract";
import { ApiError, joinPath } from "../../contract";
import {
  AssertError,
  type BaseHandlerInput,
  type HandlerOptions,
  QueryNormalizationError,
  parseBody,
  parseParams,
  parseQuery,
  parseResponse,
} from "../../server";
import { Hono } from "hono";
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
   * Maps an unexpected (non-`ApiError`) error to a typed `ApiError`. Return an `ApiError`
   * to control the response, or nothing to fall through to the built-in 500 `UNKNOWN_ERROR`.
   * Returning an `ApiError` is the only way to shape the response — the server can never emit
   * a non-`ApiError` body, regardless of whether this is provided or how it behaves.
   */
  onError?: (err: unknown, c: Context<HonoEnv>) => ApiError | void | Promise<ApiError | void>;
  middleware?: EndpointMiddlewareFactory<HonoEnv> | EndpointMiddlewareFactory<HonoEnv>[];
}

export interface RouteModule {
  _hono: Hono;
  _basePath: string;
  _endpoints: Record<string, Endpoint>;
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

        // All framework errors share the contract's `{ code }` envelope.
        const validationError = (issues: unknown) =>
          c.json({ code: "VALIDATION_ERROR", issues }, 400);

        if (endpoint.params) {
          try {
            input.params = parseParams(endpoint.params, c.req.param());
          } catch (error) {
            if (error instanceof AssertError) {
              return validationError(error.cause.errors);
            }
            throw error;
          }
        }

        if (endpoint.query) {
          try {
            input.query = parseQuery(endpoint.query, c.req.queries() as Record<string, string[]>);
          } catch (error) {
            if (error instanceof AssertError) {
              return validationError(error.cause.errors);
            }
            if (error instanceof QueryNormalizationError) {
              return validationError([{ message: error.message }]);
            }
            throw error;
          }
        }

        if (endpoint.body) {
          try {
            input.body = parseBody(endpoint.body, await c.req.json());
          } catch (error) {
            if (error instanceof AssertError) {
              return validationError(error.cause.errors);
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
          if (!shouldValidate) {
            return c.json(err.body as any, err.statusCode as any);
          }
          const schema = errors?.[err.statusCode];
          if (schema) {
            try {
              return c.json(parseResponse(schema, err.body) as any, err.statusCode as any);
            } catch (validationError) {
              if (validationError instanceof AssertError) throw err;
              throw validationError;
            }
          }
          throw err;
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

  const onError = options?.onError;
  root.onError(async (err, c) => {
    if (onError) {
      try {
        const mapped = await onError(err, c);
        // Only an ApiError can shape the response; anything else falls through.
        if (mapped instanceof ApiError) {
          return c.json(mapped.body as any, mapped.statusCode as any);
        }
      } catch (hookError) {
        console.error(hookError);
      }
    }
    // Unhandled error — log (matching Hono's default) and emit the contract envelope.
    console.error(err);
    return c.json({ code: "UNKNOWN_ERROR" }, 500);
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
