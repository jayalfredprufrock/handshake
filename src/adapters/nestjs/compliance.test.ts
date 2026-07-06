import "reflect-metadata";
import { Controller } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach } from "vite-plus/test";
import type { Api } from "../../contract";
import { createApi } from "../../contract";
import { runAdapterTests } from "../../server/testing";
import type { AdapterOptions, HandlerOptions } from "../../server";
import { ApiHandler, ApiInput, HandshakeModule } from "./index";

type HandlerEntry = { handler: (...args: any[]) => any; options?: HandlerOptions };

const apps: INestApplication[] = [];

afterEach(async () => {
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
});

/** Builds a controller class from registered handlers, applying the api decorators programmatically. */
function buildController(
  api: Api<any, any>,
  handlers: Record<string, HandlerEntry>,
): new () => unknown {
  class DynamicController {}

  for (const [name, entry] of Object.entries(handlers)) {
    const method = function (this: unknown, input: unknown): unknown {
      return entry.handler(input);
    };
    Object.defineProperty(DynamicController.prototype, name, {
      value: method,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    const descriptor = Object.getOwnPropertyDescriptor(DynamicController.prototype, name)!;
    ApiHandler(api, name as never, entry.options)(DynamicController.prototype, name, descriptor);
    ApiInput()(DynamicController.prototype, name, 0);
  }

  Controller()(DynamicController);
  return DynamicController as new () => unknown;
}

runAdapterTests((contract, options?: AdapterOptions) => {
  const api = createApi("/", { main: contract });
  const handlers: Record<string, HandlerEntry> = {};

  return {
    handle(name: string, handler: (...args: any[]) => any, handlerOptions?: HandlerOptions) {
      if (!(name in api.endpoints)) {
        throw new Error(`Unknown endpoint "${name}" — not defined in contract`);
      }
      handlers[name] = { handler, options: handlerOptions };
    },
    build() {
      const missing = Object.keys(api.endpoints).filter((name) => !(name in handlers));
      if (missing.length > 0) {
        throw new Error(`Missing handlers for endpoints: ${missing.join(", ")}`);
      }

      const ControllerClass = buildController(api, handlers);
      const ready = (async () => {
        const moduleRef = await Test.createTestingModule({
          imports: [HandshakeModule.forRoot({ ...options, apis: [api] })],
          controllers: [ControllerClass],
        }).compile();
        const app = moduleRef.createNestApplication();
        await app.listen(0, "127.0.0.1");
        apps.push(app);
        return await app.getUrl();
      })();

      return {
        request: async (url: string, init?: RequestInit): Promise<Response> => {
          const base = await ready;
          return fetch(`${base}${url}`, init);
        },
      };
    },
  };
});
