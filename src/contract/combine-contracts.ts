import type { ContractDef, Endpoint } from "./create-contract";

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void
  ? I
  : never;

type EndpointsOf<C> = C extends ContractDef<infer E> ? E : never;

type MergedEndpoints<T extends readonly ContractDef[]> =
  UnionToIntersection<EndpointsOf<T[number]>> extends infer M
    ? M extends Record<string, Endpoint>
      ? M
      : never
    : never;

function joinPath(base: string, path: string): string {
  const normBase = base === "/" || base === "" ? "" : base.replace(/\/+$/, "");
  const normPath = path === "/" || path === "" ? "" : path.startsWith("/") ? path : `/${path}`;
  const joined = `${normBase}${normPath}`;
  return joined === "" ? "/" : joined;
}

export function combineContracts<const T extends readonly ContractDef[]>(
  contracts: T,
): ContractDef<MergedEndpoints<T>>;
export function combineContracts<const T extends readonly ContractDef[]>(
  basePath: string,
  contracts: T,
): ContractDef<MergedEndpoints<T>>;
export function combineContracts(
  basePathOrContracts: string | readonly ContractDef[],
  maybeContracts?: readonly ContractDef[],
): ContractDef {
  const basePath = typeof basePathOrContracts === "string" ? basePathOrContracts : "/";
  const contracts =
    typeof basePathOrContracts === "string"
      ? maybeContracts!
      : (basePathOrContracts as readonly ContractDef[]);

  const endpoints: Record<string, Endpoint> = {};
  for (const contract of contracts) {
    for (const [name, endpoint] of Object.entries(contract.endpoints)) {
      if (name in endpoints) {
        throw new Error(`Duplicate endpoint name "${name}" in combined contracts`);
      }
      endpoints[name] = {
        ...endpoint,
        path: joinPath(contract.basePath, endpoint.path),
      };
    }
  }

  return { basePath, endpoints };
}
