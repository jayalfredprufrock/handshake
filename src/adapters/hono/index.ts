import type { ContractDef, Endpoint, InferSchema } from "../../contract";
import {
  AssertError,
  type BaseHandlerInput,
  HandlerRegistry,
  type HandlerOptions,
  QueryNormalizationError,
  parseBody,
  parseParams,
  parseQuery,
  parseResponse,
} from "../../server";
import { Hono } from "hono";
import type { Context, Env } from "hono";

type HandlerInput<E extends Endpoint, HonoEnv extends Env> = BaseHandlerInput<E> & {
  c: Context<HonoEnv>;
};

type Handler<E extends Endpoint, HonoEnv extends Env> = (
  input: HandlerInput<E, HonoEnv>,
) => InferSchema<E["response"]> | Response | Promise<InferSchema<E["response"]> | Response>;

export interface HandshakeApp<C extends ContractDef, HonoEnv extends Env = Env> {
  implement<K extends keyof C["endpoints"] & string>(
    name: K,
    handler: Handler<C["endpoints"][K], HonoEnv>,
    options?: HandlerOptions,
  ): void;
  build(): Hono<HonoEnv>;
}

export type HandshakeHono<C extends ContractDef, HonoEnv extends Env = Env> = Hono<HonoEnv> & {
  implement: HandshakeApp<C, HonoEnv>["implement"];
};

export interface CreateHonoAppOptions {
  basePath?: string;
  validateResponse?: boolean;
}

export type RouteRegister<C extends ContractDef> = (app: HandshakeHono<C>) => void;

export type RouteHandlersMap<C extends ContractDef> = {
  [K in keyof C["endpoints"] & string]: Handler<C["endpoints"][K], Env>;
};

export interface RouteModule<C extends ContractDef = ContractDef> {
  readonly contract: C;
  readonly impl: RouteRegister<C> | RouteHandlersMap<C>;
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

export function implementContract<C extends ContractDef>(
  contract: C,
  impl: RouteRegister<C> | RouteHandlersMap<C>,
): RouteModule<C> {
  return { contract, impl };
}

export function createHonoApp<C extends ContractDef>(
  contract: C,
  options?: CreateHonoAppOptions,
): HandshakeApp<C>;
export function createHonoApp<HonoEnv extends Env, C extends ContractDef>(
  app: Hono<HonoEnv>,
  contract: C,
  options?: CreateHonoAppOptions,
): HandshakeApp<C, HonoEnv>;
export function createHonoApp(routes: readonly RouteModule[], options?: CreateHonoAppOptions): Hono;
export function createHonoApp<HonoEnv extends Env>(
  app: Hono<HonoEnv>,
  routes: readonly RouteModule[],
  options?: CreateHonoAppOptions,
): Hono<HonoEnv>;
export function createHonoApp(
  appOrContractOrRoutes: Hono | ContractDef | readonly RouteModule[],
  contractOrRoutesOrOptions?: ContractDef | readonly RouteModule[] | CreateHonoAppOptions,
  maybeOptions?: CreateHonoAppOptions,
): HandshakeApp<ContractDef, Env> | Hono {
  const firstIsHono = appOrContractOrRoutes instanceof Hono;
  const providedApp = firstIsHono ? (appOrContractOrRoutes as Hono) : undefined;
  const second = firstIsHono ? contractOrRoutesOrOptions : appOrContractOrRoutes;
  const options = ((firstIsHono
    ? maybeOptions
    : (contractOrRoutesOrOptions as CreateHonoAppOptions)) ?? {}) as CreateHonoAppOptions;

  if (Array.isArray(second)) {
    const root = providedApp ?? new Hono();
    for (const route of second as readonly RouteModule[]) {
      const subHono = new Hono();
      const subApi = createSingleContractApp(subHono, route.contract, {
        ...options,
        basePath: "",
      });
      if (typeof route.impl === "function") {
        const handshakeHono = subHono as HandshakeHono<ContractDef>;
        handshakeHono.implement = subApi.implement.bind(subApi);
        route.impl(handshakeHono);
      } else {
        for (const [name, handler] of Object.entries(route.impl)) {
          subApi.implement(name as any, handler as any);
        }
      }
      subApi.build();
      root.route(route.contract.basePath, subHono);
    }
    return root;
  }

  return createSingleContractApp(providedApp, second as ContractDef, options);
}

function createSingleContractApp(
  providedApp: Hono | undefined,
  contract: ContractDef,
  options: CreateHonoAppOptions,
): HandshakeApp<ContractDef, Env> {
  const registry = new HandlerRegistry(contract);

  return {
    implement(name, handler, handlerOptions) {
      registry.register(name, handler, handlerOptions);
    },

    build() {
      registry.validateComplete();
      const app = providedApp ?? new Hono();
      const basePath = options.basePath ?? registry.basePath;

      const sorted = [...registry.entries].sort(([, a], [, b]) =>
        compareSpecificity(a.path, b.path),
      );

      for (const [name, endpoint] of sorted) {
        const handler = registry.getHandler(name);
        const handlerOptions = registry.getHandlerOptions(name);
        const method = methodMap[endpoint.method];
        const fullPath = `${basePath}${endpoint.path}`;

        app[method](fullPath, async (c: Context) => {
          const input: Record<string, unknown> = { c };

          if (endpoint.params) {
            try {
              input.params = parseParams(endpoint.params, c.req.param());
            } catch (error) {
              if (error instanceof AssertError) {
                return c.json(
                  { error: "Invalid path parameters", details: error.cause.errors },
                  400,
                );
              }
              throw error;
            }
          }

          if (endpoint.query) {
            try {
              input.query = parseQuery(endpoint.query, c.req.queries() as Record<string, string[]>);
            } catch (error) {
              if (error instanceof AssertError) {
                return c.json(
                  { error: "Invalid query parameters", details: error.cause.errors },
                  400,
                );
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

          const result = await handler(input as any);

          if (result instanceof Response) {
            return result;
          }

          const shouldValidate =
            handlerOptions?.validateResponse ?? options.validateResponse ?? true;

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

      return app;
    },
  };
}
