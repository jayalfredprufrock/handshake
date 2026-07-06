import { createApi } from "../../contract";
import { runAdapterTests } from "../../server/testing";
import { buildRoutes, createHonoApp } from "./index";

runAdapterTests((contract, options) => {
  const api = createApi("/", { main: contract });
  const handlers: Record<string, any> = {};
  const perHandlerOptions: Record<string, any> = {};

  return {
    handle: (name: string, handler: (...args: any[]) => any, handlerOptions?: any) => {
      if (!(name in api.endpoints)) {
        throw new Error(`Unknown endpoint "${name}" — not defined in contract`);
      }
      handlers[name] = handler;
      if (handlerOptions) perHandlerOptions[name] = handlerOptions;
    },
    build: () => {
      const routes = buildRoutes(
        api,
        (group) => {
          for (const [name, handler] of Object.entries(handlers)) {
            group.implement(name as any, handler as any, perHandlerOptions[name]);
          }
        },
        options,
      );
      const app = createHonoApp({ routes: [routes] });
      return {
        request: (url: string, init?: RequestInit) => Promise.resolve(app.request(url, init)),
      };
    },
  };
});
