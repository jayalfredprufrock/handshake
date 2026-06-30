import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import type { Contract } from "../../contract";
import { RESERVED_ERROR_CODES } from "../../contract";
import { HandshakeExceptionFilter } from "./filter";
import { HandshakeInterceptor } from "./interceptor";
import { HANDSHAKE_OPTIONS } from "./types";
import type { HandshakeModuleOptions, ResolvedOptions } from "./types";

/** Collects framework + every (sub)contract's declared error codes into one set. */
function buildKnownCodes(contracts: Contract<any, any, any>[]): Set<string> {
  const codes = new Set<string>(RESERVED_ERROR_CODES);
  const visit = (contract: Contract<any, any, any>): void => {
    if (contract.errors) for (const code of Object.keys(contract.errors)) codes.add(code);
    if (contract.named) {
      for (const sub of Object.values(contract.named)) visit(sub as Contract<any, any, any>);
    }
  };
  for (const contract of contracts) visit(contract);
  return codes;
}

/**
 * Registers the handshake interceptor (request parse/validate + response
 * validation) and exception filter (envelope serialization) globally. Import
 * once at the app root.
 *
 * ```ts
 * @Module({
 *   imports: [HandshakeModule.forRoot({ contracts: [contract] })],
 *   controllers: [UserController],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class HandshakeModule {
  static forRoot(options: HandshakeModuleOptions = {}): DynamicModule {
    const resolved: ResolvedOptions = {
      validateResponse: options.validateResponse,
      onError: options.onError,
      knownCodes: options.contracts ? buildKnownCodes(options.contracts) : undefined,
    };

    return {
      module: HandshakeModule,
      global: true,
      providers: [
        { provide: HANDSHAKE_OPTIONS, useValue: resolved },
        { provide: APP_INTERCEPTOR, useClass: HandshakeInterceptor },
        { provide: APP_FILTER, useClass: HandshakeExceptionFilter },
      ],
      exports: [HANDSHAKE_OPTIONS],
    };
  }
}
