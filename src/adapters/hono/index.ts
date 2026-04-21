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
  handle<K extends keyof C["endpoints"] & string>(
    name: K,
    handler: Handler<C["endpoints"][K], HonoEnv>,
    options?: HandlerOptions,
  ): void;
  build(): Hono<HonoEnv>;
}

export interface CreateHonoAppOptions {
  basePath?: string;
  validateResponse?: boolean;
}

const methodMap = {
  GET: "get",
  POST: "post",
  PATCH: "patch",
  DELETE: "delete",
} as const;

export function createHonoApp<C extends ContractDef>(
  contract: C,
  options?: CreateHonoAppOptions,
): HandshakeApp<C>;
export function createHonoApp<HonoEnv extends Env, C extends ContractDef>(
  app: Hono<HonoEnv>,
  contract: C,
  options?: CreateHonoAppOptions,
): HandshakeApp<C, HonoEnv>;
export function createHonoApp(
  appOrContract: Hono | ContractDef,
  contractOrOptions?: ContractDef | CreateHonoAppOptions,
  maybeOptions?: CreateHonoAppOptions,
): HandshakeApp<ContractDef, Env> {
  const providedApp = appOrContract instanceof Hono ? appOrContract : undefined;
  const contract = (providedApp ? contractOrOptions : appOrContract) as ContractDef;
  const options = (providedApp ? maybeOptions : (contractOrOptions as CreateHonoAppOptions)) ?? {};

  const registry = new HandlerRegistry(contract);

  return {
    handle(name, handler, handlerOptions) {
      registry.register(name, handler, handlerOptions);
    },

    build() {
      registry.validateComplete();
      const app = providedApp ?? new Hono();
      const basePath = options.basePath ?? registry.basePath;

      for (const [name, endpoint] of registry.entries) {
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
