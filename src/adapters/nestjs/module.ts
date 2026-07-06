import { Inject, Injectable, Module } from "@nestjs/common";
import type { DynamicModule, OnApplicationBootstrap } from "@nestjs/common";
import {
  APP_FILTER,
  APP_INTERCEPTOR,
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from "@nestjs/core";
import type { Api } from "../../contract";
import { RESERVED_ERROR_CODES, joinPath } from "../../contract";
import { HANDSHAKE_META } from "./decorators";
import { HandshakeExceptionFilter } from "./filter";
import { HandshakeInterceptor } from "./interceptor";
import { HANDSHAKE_OPTIONS } from "./types";
import type { HandshakeMeta, HandshakeModuleOptions, ResolvedOptions } from "./types";

function toApiArray(apis: HandshakeModuleOptions["apis"]): Api<any, any>[] {
  if (!apis) return [];
  return Array.isArray(apis) ? apis : [apis];
}

/** Collects framework + every api's declared error codes into one set. */
function buildKnownCodes(apis: Api<any, any>[]): Set<string> {
  const codes = new Set<string>(RESERVED_ERROR_CODES);
  for (const api of apis) {
    if (api.errors) for (const code of Object.keys(api.errors)) codes.add(code);
  }
  return codes;
}

/**
 * At bootstrap, scans every controller method for `@ApiHandler` metadata and asserts,
 * per registered api: every endpoint is implemented exactly once, and no two routes
 * collide on `(method, path)`.
 */
@Injectable()
class HandshakeBootstrap implements OnApplicationBootstrap {
  constructor(
    @Inject(HANDSHAKE_OPTIONS) private readonly options: ResolvedOptions,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const apis = this.options.apis;
    if (!apis || apis.length === 0) return;

    const implementedByApi = new Map<Api<any, any>, Set<string>>();
    const seenPath = new Map<string, string>();

    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | null;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const method = proto[methodName];
        if (typeof method !== "function") continue;
        const meta = this.reflector.get<HandshakeMeta | undefined>(HANDSHAKE_META, method);
        if (!meta) continue;

        const names = implementedByApi.get(meta.api) ?? new Set<string>();
        if (names.has(meta.endpointName)) {
          throw new Error(`Endpoint "${meta.endpointName}" is implemented more than once`);
        }
        names.add(meta.endpointName);
        implementedByApi.set(meta.api, names);

        const key = `${meta.endpoint.method} ${joinPath(meta.api.basePath, meta.endpoint.path)}`;
        const prev = seenPath.get(key);
        if (prev) {
          throw new Error(
            `Route conflict: ${key} implemented by "${prev}" and "${meta.endpointName}"`,
          );
        }
        seenPath.set(key, meta.endpointName);
      }
    }

    for (const api of apis) {
      const names = implementedByApi.get(api) ?? new Set<string>();
      const missing = Object.keys(api.endpoints as Record<string, unknown>).filter(
        (name) => !names.has(name),
      );
      if (missing.length > 0) {
        throw new Error(
          `Api at "${api.basePath}" is missing @ApiHandler for: ${missing.join(", ")}`,
        );
      }
    }
  }
}

/**
 * Registers the handshake interceptor (request parse/validate + response validation)
 * and exception filter (envelope serialization) globally, and — when `apis` are
 * provided — asserts full implementation at bootstrap. Import once at the app root.
 *
 * ```ts
 * @Module({
 *   imports: [HandshakeModule.forRoot({ apis: [api] })],
 *   controllers: [JobsController],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class HandshakeModule {
  static forRoot(options: HandshakeModuleOptions = {}): DynamicModule {
    const apis = toApiArray(options.apis);
    const resolved: ResolvedOptions = {
      validateResponse: options.validateResponse,
      onError: options.onError,
      knownCodes: apis.length > 0 ? buildKnownCodes(apis) : undefined,
      apis,
    };

    return {
      module: HandshakeModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        { provide: HANDSHAKE_OPTIONS, useValue: resolved },
        { provide: APP_INTERCEPTOR, useClass: HandshakeInterceptor },
        { provide: APP_FILTER, useClass: HandshakeExceptionFilter },
        HandshakeBootstrap,
      ],
      exports: [HANDSHAKE_OPTIONS],
    };
  }
}
