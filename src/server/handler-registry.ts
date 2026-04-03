import type { ContractDef, Endpoint } from "../contract";
import type { HandlerOptions } from "./types";

export class HandlerRegistry {
  private handlers = new Map<
    string,
    { handler: (...args: any[]) => any; options?: HandlerOptions }
  >();
  private endpointNames: Set<string>;
  private contract: ContractDef;

  constructor(contract: ContractDef) {
    this.contract = contract;
    this.endpointNames = new Set(Object.keys(contract.endpoints));
  }

  register(name: string, handler: (...args: any[]) => any, options?: HandlerOptions): void {
    if (!this.endpointNames.has(name)) {
      throw new Error(`Unknown endpoint "${name}" — not defined in contract`);
    }
    this.handlers.set(name, { handler, options });
  }

  validateComplete(): void {
    const missing = [...this.endpointNames].filter((name) => !this.handlers.has(name));
    if (missing.length > 0) {
      throw new Error(`Missing handlers for endpoints: ${missing.join(", ")}`);
    }
  }

  getHandler(name: string): (...args: any[]) => any {
    return this.handlers.get(name)!.handler;
  }

  getHandlerOptions(name: string): HandlerOptions | undefined {
    return this.handlers.get(name)?.options;
  }

  get entries(): [string, Endpoint][] {
    return Object.entries(this.contract.endpoints);
  }

  get basePath(): string {
    return this.contract.basePath === "/" ? "" : this.contract.basePath;
  }
}
