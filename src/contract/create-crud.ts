import { type TArray, type TPartial, type TSchema } from "typebox";
import * as T from "typebox";
import { DeepOmit, DeepPick } from "../typebox";
import type { DeepKeyOf, TDeepOmit, TDeepPick } from "../typebox";
import type { EndpointMeta, MetaField } from "./create-contract";

export type Merge2<A, B> = A extends readonly string[]
  ? B extends readonly string[]
    ? [...A, ...B]
    : A
  : B extends readonly string[]
    ? B
    : [];

export type Merge3<A, B, C> = Merge2<Merge2<A, B>, C>;

export type TryPick<T extends TSchema, P> = P extends readonly string[]
  ? TDeepPick<T, P[number]>
  : T;

export type TryOmit<T extends TSchema, O> = O extends readonly string[]
  ? TDeepOmit<T, O[number]>
  : T;

export type MakePath<B extends string, P> = P extends readonly [infer P1, ...infer R]
  ? P1 extends string
    ? MakePath<`${B}/:${P1}`, R>
    : B
  : B;

/** Top-level keys across every object member of a schema (path params are not nested). */
export type TopKeyOf<T extends TSchema> = Exclude<DeepKeyOf<T>, `${string}.${string}`>;

export type CrudContractConfig<T extends TSchema> = {
  params: TopKeyOf<T>[];
  hidden?: DeepKeyOf<T>[];
  readonly?: DeepKeyOf<T>[];
  immutable?: DeepKeyOf<T>[];
} & MetaField<EndpointMeta>;

export type CrudContract<T extends TSchema, C extends CrudContractConfig<T>> = {
  get: {
    method: "GET";
    path: MakePath<"", C["params"]>;
    params: TryPick<T, C["params"]>;
    response: TryOmit<T, C["hidden"]>;
  } & MetaField<EndpointMeta>;
  list: {
    method: "GET";
    path: "/";
    response: TArray<TryOmit<T, C["hidden"]>>;
  } & MetaField<EndpointMeta>;
  create: {
    method: "POST";
    path: "/";
    body: TryOmit<T, Merge2<C["hidden"], C["readonly"]>>;
    response: TryOmit<T, C["hidden"]>;
  } & MetaField<EndpointMeta>;
  update: {
    method: "PATCH";
    path: MakePath<"", C["params"]>;
    params: TryPick<T, C["params"]>;
    body: TPartial<TryOmit<T, Merge3<C["hidden"], C["readonly"], C["immutable"]>>>;
    response: TryOmit<T, C["hidden"]>;
  } & MetaField<EndpointMeta>;
  delete: {
    method: "DELETE";
    path: MakePath<"", C["params"]>;
    params: TryPick<T, C["params"]>;
    response: TryOmit<T, C["hidden"]>;
  } & MetaField<EndpointMeta>;
};

export const createCrud = <T extends TSchema, const C extends CrudContractConfig<T>>(
  schema: T,
  config: C,
): CrudContract<T, C> => {
  const paramsPath =
    `/${config.params.map((param) => `:${param.toString()}`).join("/")}` as MakePath<
      "",
      C["params"]
    >;
  const hidden = (config.hidden ?? []) as DeepKeyOf<T>[];
  const ro = (config.readonly ?? []) as DeepKeyOf<T>[];
  const immutable = (config.immutable ?? []) as DeepKeyOf<T>[];

  const response = (config.hidden ? DeepOmit(schema, hidden) : schema) as TryOmit<T, C["hidden"]>;
  const params = DeepPick(schema, config.params as DeepKeyOf<T>[]) as any;
  const meta = (config as { meta?: EndpointMeta }).meta;
  const metaField = meta !== undefined ? { meta } : {};

  return {
    get: { method: "GET", path: paramsPath, params, response, ...metaField },
    list: { method: "GET", path: "/", response: T.Array(response), ...metaField },
    delete: { method: "DELETE", path: paramsPath, params, response, ...metaField },
    create: {
      method: "POST",
      path: "/",
      response,
      body: DeepOmit(schema, [...hidden, ...ro]) as any,
      ...metaField,
    },
    update: {
      method: "PATCH",
      path: paramsPath,
      response,
      params,
      body: T.Partial(DeepOmit(schema, [...hidden, ...ro, ...immutable])) as any,
      ...metaField,
    },
  } as CrudContract<T, C>;
};
