import type { Static, TSchema } from "typebox";
import type { Contract, Endpoint, InferSchema } from "../contract";

export type BaseHandlerInput<E extends Endpoint> = (E["params"] extends TSchema
  ? { params: Static<E["params"]> }
  : {}) &
  (E["body"] extends TSchema ? { body: Static<E["body"]> } : {}) &
  (E["query"] extends TSchema ? { query: Static<E["query"]> } : {}) &
  (E["headers"] extends TSchema ? { headers: Static<E["headers"]> } : {});

export type BaseHandler<E extends Endpoint> = (
  input: BaseHandlerInput<E>,
) => InferSchema<E["response"]> | Response | Promise<InferSchema<E["response"]> | Response>;

export interface HandlerOptions {
  validateResponse?: boolean;
}

export interface AdapterOptions {
  validateResponse?: boolean;
}

export interface AdapterTestHarness {
  handle(name: string, handler: (...args: any[]) => any, options?: HandlerOptions): void;
  build(): { request(url: string, init?: RequestInit): Promise<Response> };
}

export type AdapterFactory = (
  contract: Contract<any, any>,
  options?: AdapterOptions,
) => AdapterTestHarness;
