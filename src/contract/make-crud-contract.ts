import {
  type Static,
  type TArray,
  type TOmit,
  type TPartial,
  type TPick,
  type TSchema,
  Type,
} from "typebox";

export type Merge2<A, B> = A extends string[]
  ? B extends string[]
    ? [...A, ...B]
    : A
  : B extends string[]
    ? B
    : [];

export type Merge3<A, B, C> = Merge2<Merge2<A, B>, C>;

export type TryPick<T extends TSchema, P> = P extends PropertyKey[] ? TPick<T, P> : T;
export type TryOmit<T extends TSchema, O> = O extends PropertyKey[] ? TOmit<T, O> : T;

export type MakePath<B extends string, P> = P extends [infer P1, ...infer R]
  ? P1 extends string
    ? MakePath<`${B}/:${P1}`, R>
    : B
  : B;

export type AllKeys<T> = Extract<T extends any ? keyof T : never, string>;

export interface CrudContractConfig<S> {
  basePath: string;
  params: (keyof S)[];
  hidden?: AllKeys<S>[];
  readonly?: AllKeys<S>[];
  immutable?: AllKeys<S>[];
  meta?: Record<string, any>;
}

export type CrudContract<T extends TSchema, C extends CrudContractConfig<Static<T>>> = {
  get: {
    method: "GET";
    path: MakePath<C["basePath"], C["params"]>;
    params: TryPick<T, C["params"]>;
    response: TryOmit<T, C["hidden"]>;
  };
  list: {
    method: "GET";
    path: C["basePath"];
    response: TArray<TryOmit<T, C["hidden"]>>;
  };
  create: {
    method: "POST";
    path: C["basePath"];
    body: TOmit<T, Merge2<C["hidden"], C["readonly"]>>;
    response: TryOmit<T, C["hidden"]>;
  };
  update: {
    method: "PATCH";
    path: MakePath<C["basePath"], C["params"]>;
    params: TryPick<T, C["params"]>;
    body: TPartial<TryOmit<T, Merge3<C["hidden"], C["readonly"], C["immutable"]>>>;
    response: TryOmit<T, C["hidden"]>;
  };
  delete: {
    method: "DELETE";
    path: MakePath<C["basePath"], C["params"]>;
    params: TryPick<T, C["params"]>;
    response: TryOmit<T, C["hidden"]>;
  };
};

const normalizePath = (path: string): string => {
  // transforms "\" to "/"
  // removes duplicate separators
  // enforces a leading slash
  // removes any trailing slashes
  return `/${path.replace(/\/{2,}|\\+/g, "/").replace(/(^\/)|(\/$)/, "")}`;
};

export const makeCrudContract = <T extends TSchema, const C extends CrudContractConfig<Static<T>>>(
  schema: T,
  config: C,
): CrudContract<T, C> => {
  const basePath = normalizePath(config.basePath);
  const paramsPath = normalizePath(
    `${basePath}/${config.params?.map((param) => `:${param.toString()}`).join("/") ?? ""}`,
  ) as MakePath<C["basePath"], C["params"]>;
  const response = (config.hidden ? Type.Omit(schema, config.hidden) : schema) as TryOmit<
    T,
    C["hidden"]
  >;
  const params = Type.Pick(schema, config.params) as any;
  const hidden = config.hidden ?? [];
  const ro = config.readonly ?? [];
  const immutable = config.immutable ?? [];

  return {
    get: { method: "GET", path: paramsPath, params, response },
    list: { method: "GET", path: basePath, response: Type.Array(response) },
    delete: { method: "DELETE", path: paramsPath, params, response },
    create: {
      method: "POST",
      path: basePath,
      response,
      body: Type.Omit(schema, [...hidden, ...ro]) as any,
    },
    update: {
      method: "PATCH",
      path: paramsPath,
      response,
      params,
      body: Type.Partial(Type.Omit(schema, [...hidden, ...ro, ...immutable])) as any,
    },
  };
};
