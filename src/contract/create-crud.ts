import {
  type Static,
  type TArray,
  type TKeysToIndexer,
  type TOmit,
  type TPartial,
  type TPick,
  type TSchema,
  Type,
} from "typebox";
import type { EndpointMeta, MetaField } from "./create-contract";

export type Merge2<A, B> = A extends string[]
  ? B extends string[]
    ? [...A, ...B]
    : A
  : B extends string[]
    ? B
    : [];

export type Merge3<A, B, C> = Merge2<Merge2<A, B>, C>;

export type TryPick<T extends TSchema, P> = P extends PropertyKey[]
  ? TPick<T, TKeysToIndexer<P>>
  : T;

export type TryOmit<T extends TSchema, O> = O extends PropertyKey[]
  ? TOmit<T, TKeysToIndexer<O>>
  : T;

export type MakePath<B extends string, P> = P extends [infer P1, ...infer R]
  ? P1 extends string
    ? MakePath<`${B}/:${P1}`, R>
    : B
  : B;

export type AllKeys<T> = Extract<T extends any ? keyof T : never, string>;

export type CrudContractConfig<S> = {
  params: AllKeys<S>[];
  hidden?: AllKeys<S>[];
  readonly?: AllKeys<S>[];
  immutable?: AllKeys<S>[];
} & MetaField<EndpointMeta>;

export type CrudContract<T extends TSchema, C extends CrudContractConfig<Static<T>>> = {
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

export const createCrud = <T extends TSchema, const C extends CrudContractConfig<Static<T>>>(
  schema: T,
  config: C,
): CrudContract<T, C> => {
  const paramsPath =
    `/${config.params.map((param) => `:${param.toString()}`).join("/")}` as MakePath<
      "",
      C["params"]
    >;
  const response = (config.hidden ? Type.Omit(schema, config.hidden) : schema) as TryOmit<
    T,
    C["hidden"]
  >;
  const params = Type.Pick(schema, config.params) as any;
  const hidden = config.hidden ?? [];
  const ro = config.readonly ?? [];
  const immutable = config.immutable ?? [];
  const meta = (config as { meta?: EndpointMeta }).meta;
  const metaField = meta !== undefined ? { meta } : {};

  return {
    get: { method: "GET", path: paramsPath, params, response, ...metaField },
    list: { method: "GET", path: "/", response: Type.Array(response), ...metaField },
    delete: { method: "DELETE", path: paramsPath, params, response, ...metaField },
    create: {
      method: "POST",
      path: "/",
      response,
      body: Type.Omit(schema, [...hidden, ...ro]) as any,
      ...metaField,
    },
    update: {
      method: "PATCH",
      path: paramsPath,
      response,
      params,
      body: Type.Partial(Type.Omit(schema, [...hidden, ...ro, ...immutable])) as any,
      ...metaField,
    },
  } as CrudContract<T, C>;
};
