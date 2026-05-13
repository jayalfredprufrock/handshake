import { runAdapterTests } from "../../server/testing";
import { implementContract, createHonoApp } from "./index";

runAdapterTests((contract, options) => {
  const handlers: Record<string, any> = {};
  const perHandlerOptions: Record<string, any> = {};

  return {
    handle: (name: string, handler: (...args: any[]) => any, handlerOptions?: any) => {
      const endpointNames = Object.keys(contract.endpoints);
      if (!endpointNames.includes(name)) {
        throw new Error(`Unknown endpoint "${name}" — not defined in contract`);
      }
      handlers[name] = handler;
      if (handlerOptions) perHandlerOptions[name] = handlerOptions;
    },
    build: () => {
      const module = implementContract(
        contract,
        (group) => {
          for (const [name, handler] of Object.entries(handlers)) {
            group.implement(name as any, handler as any, perHandlerOptions[name]);
          }
        },
        options,
      );
      const app = createHonoApp(contract, [module]);
      return {
        request: (url: string, init?: RequestInit) => Promise.resolve(app.request(url, init)),
      };
    },
  };
});
