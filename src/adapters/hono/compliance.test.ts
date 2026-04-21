import { runAdapterTests } from "../../server/testing";
import { createHonoApp } from "./index";

runAdapterTests((contract, options) => {
  const api = createHonoApp(contract, options);
  return {
    handle: (name: string, handler: (...args: any[]) => any, handlerOptions?: any) =>
      api.handle(name as any, handler as any, handlerOptions),
    build: () => {
      const app = api.build();
      return {
        request: (url: string, init?: RequestInit) => Promise.resolve(app.request(url, init)),
      };
    },
  };
});
