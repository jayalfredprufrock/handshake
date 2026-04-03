import type { Static, TSchema } from "typebox";
import type { ContractDef, Endpoint, InferSchema } from "../contract";

export type BaseHandlerInput<E extends Endpoint> = (E["params"] extends TSchema
  ? { params: Static<E["params"]> }
  : {}) &
  (E["body"] extends TSchema ? { body: Static<E["body"]> } : {}) &
  (E["query"] extends TSchema ? { query: Static<E["query"]> } : {});

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
  contract: ContractDef,
  options?: AdapterOptions,
) => AdapterTestHarness;
