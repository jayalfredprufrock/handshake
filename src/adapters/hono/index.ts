import type { Contract, Endpoint, ExtractGlobalErrors, InferSchema } from "../../contract";
import { ApiError, computeEffectiveErrors, joinPath } from "../../contract";
import {
  AssertError,
  type BaseHandlerInput,
  type HandlerOptions,
  QueryNormalizationError,
  checkValue,
  parseBody,
  parseParams,
  parseQuery,
  parseResponse,
} from "../../server";
import { Hono } from "hono";
import type { Context, Env, MiddlewareHandler } from "hono";
import type { Static, TSchema } from "typebox";

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

export interface CreateHonoAppOptions<
  G extends TSchema | undefined = undefined,
  HonoEnv extends Env = Env,
> {
  errorHandler?: G extends TSchema
    ? (err: unknown) => ApiError<Static<G>>
    : (err: unknown) => ApiError;
  middleware?: EndpointMiddlewareFactory<HonoEnv> | EndpointMiddlewareFactory<HonoEnv>[];
}

export interface RouteModule {
  _hono: Hono;
  _basePath: string;
  _endpoints: Record<string, Endpoint>;
}

const methodMap = {
  GET: "get",
  POST: "post",
  PATCH: "patch",
  DELETE: "delete",
} as const;

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
  globalErrors: TSchema | undefined,
  subHono: Hono,
  mountPath: string,
  moduleOptions: ImplementContractOptions,
): RouteModule {
  const missing = Object.keys(endpoints).filter((name) => !(name in handlers));
  if (missing.length > 0) {
    throw new Error(`Missing handlers for endpoints: ${missing.join(", ")}`);
  }

  const sorted = Object.entries(endpoints).sort(([, a], [, b]) =>
    compareSpecificity(a.path, b.path),
  );

  for (const [name, endpoint] of sorted) {
    const handler = handlers[name];
    const handlerOptions = perHandlerOptions[name];

    const middleware = toMiddlewareArray(moduleOptions.middleware?.(endpoint));

    subHono.on(endpoint.method, [endpoint.path], ...middleware, async (c: Context) => {
      const input: Record<string, unknown> = { c };

      if (endpoint.params) {
        try {
          input.params = parseParams(endpoint.params, c.req.param());
        } catch (error) {
          if (error instanceof AssertError) {
            return c.json({ error: "Invalid path parameters", details: error.cause.errors }, 400);
          }
          throw error;
        }
      }

      if (endpoint.query) {
        try {
          input.query = parseQuery(endpoint.query, c.req.queries() as Record<string, string[]>);
        } catch (error) {
          if (error instanceof AssertError) {
            return c.json({ error: "Invalid query parameters", details: error.cause.errors }, 400);
          }
          if (error instanceof QueryNormalizationError) {
            return c.json({ error: error.message }, 400);
          }
          throw error;
        }
      }

      if (endpoint.body) {
        try {
          input.body = parseBody(endpoint.body, await c.req.json());
        } catch (error) {
          if (error instanceof AssertError) {
            return c.json({ error: "Invalid request body", details: error.cause.errors }, 400);
          }
          throw error;
        }
      }

      let result: unknown;
      try {
        result = await handler(input as any);
      } catch (err) {
        const effectiveErrors = computeEffectiveErrors(globalErrors, endpoint.errors);
        if (err instanceof ApiError) {
          if (!effectiveErrors || checkValue(effectiveErrors, err.body)) {
            return c.json(err.body, err.statusCode as any);
          }
        }
        throw err;
      }

      if (result instanceof Response) {
        return result;
      }

      const shouldValidate =
        handlerOptions?.validateResponse ?? moduleOptions.validateResponse ?? true;

      if (shouldValidate && endpoint.response) {
        try {
          return c.json(parseResponse(endpoint.response, result));
        } catch (error) {
          if (error instanceof AssertError) {
            return c.json(
              { error: "Response validation failed", details: error.cause.errors },
              500,
            );
          }
          throw error;
        }
      }

      return c.json(result);
    });
  }

  return { _hono: subHono, _basePath: mountPath, _endpoints: endpoints };
}

// Named group, object handlers or closure
export function implementContract<
  C extends Record<string, Endpoint>,
  G extends TSchema | undefined,
  N extends Record<string, Contract<any, any>>,
  K extends keyof N & string,
  HonoEnv extends Env = Env,
>(
  contract: Contract<C, G, N>,
  groupName: K,
  handlersOrClosure:
    | HandlerMap<N[K]["endpoints"], HonoEnv>
    | ((group: GroupBuilder<N[K]["endpoints"], HonoEnv>) => void),
  options?: ImplementContractOptions<HonoEnv>,
): RouteModule;

// Unnamed, object handlers or closure
export function implementContract<
  C extends Record<string, Endpoint>,
  G extends TSchema | undefined,
  HonoEnv extends Env = Env,
>(
  contract: Contract<C, G, any>,
  handlersOrClosure: HandlerMap<C, HonoEnv> | ((group: GroupBuilder<C, HonoEnv>) => void),
  options?: ImplementContractOptions<HonoEnv>,
): RouteModule;

export function implementContract(
  contract: Contract<any, any, any>,
  arg2: string | Record<string, any> | ((group: any) => void),
  arg3?: Record<string, any> | ((group: any) => void) | ImplementContractOptions,
  arg4?: ImplementContractOptions,
): RouteModule {
  const subHono = new Hono();
  const handlers: Record<string, any> = {};
  const perHandlerOptions: Record<string, HandlerOptions | undefined> = {};

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
        subHono.use("*", middleware);
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
    contract.globalErrors,
    subHono,
    mountPath,
    options,
  );
}

export function createHonoApp<C extends Contract<any, any, any>, HonoEnv extends Env = Env>(
  contract: C,
  modules: RouteModule[],
  options?: CreateHonoAppOptions<ExtractGlobalErrors<C>, HonoEnv>,
): Hono {
  const root = new Hono();

  const errorHandler = options?.errorHandler;
  root.onError((err, c) => {
    if (errorHandler) {
      const apiErr = errorHandler(err);
      return c.json(apiErr.body, apiErr.statusCode as any);
    }
    return c.json({ error: "Internal Server Error" }, 500);
  });

  const middlewareFactories = options?.middleware
    ? Array.isArray(options.middleware)
      ? options.middleware
      : [options.middleware]
    : [];

  if (middlewareFactories.length > 0) {
    for (const module of modules) {
      for (const endpoint of Object.values(module._endpoints)) {
        const fullPath = module._basePath + endpoint.path;
        const middleware = middlewareFactories.flatMap((f) => toMiddlewareArray(f(endpoint)));
        if (middleware.length > 0) {
          root.on(endpoint.method, [fullPath || "/"], ...middleware);
        }
      }
    }
  }

  for (const module of modules) {
    root.route(module._basePath || "/", module._hono);
  }

  return root;
}
