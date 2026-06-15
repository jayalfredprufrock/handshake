import { type TObject, type TProperties, type TSchema, type TUnion } from "typebox";
import * as T from "typebox";

/**
 * The object schema "members" of a schema: the schema itself when it is a single
 * object, or each variant of a union. Non-object members are discarded so that
 * key gathering only considers object shapes.
 */
type ObjectMembers<S extends TSchema> =
  S extends TUnion<infer Variants> ? Extract<Variants[number], TObject> : Extract<S, TObject>;

/** String keys of a single object member (distributed over a union of members). */
type ObjectKeys<M> = M extends TObject<infer P> ? Extract<keyof P, string> : never;

/**
 * Every string property key found across all object members. Unlike TypeBox's
 * own indexing helpers (which intersect union member keys), this collects the
 * *union* of keys, so a property present on only some union members is included.
 */
type MemberKeys<S extends TSchema> = ObjectKeys<ObjectMembers<S>>;

/** The property schema(s) at key `K` across every object member that defines it. */
type MemberProp<S extends TSchema, K extends string> =
  ObjectMembers<S> extends infer Member
    ? Member extends TObject<infer P>
      ? K extends keyof P
        ? P[K]
        : never
      : never
    : never;

/** Nested keys reachable through key `K`, supporting nested objects and unions of objects. */
type NestedKeys<S extends TSchema, K extends string> = MemberKeys<MemberProp<S, K>>;

/**
 * The set of dot-paths accepted by {@link DeepPick} / {@link DeepOmit} for schema `S`.
 *
 * Includes every top-level key (selecting the whole property) plus a single level
 * of nested keys via dot notation (e.g. `"address.street"`). Nested keys are only
 * offered for properties whose value is an object or a union of objects.
 */
export type DeepKeyOf<S extends TSchema> = {
  [K in MemberKeys<S>]: K | `${K}.${NestedKeys<S, K>}`;
}[MemberKeys<S>];

/** The top-level component of a (possibly nested) key path. */
type Head<U extends string> = U extends `${infer H}.${string}` ? H : U;

/** The nested children requested for parent key `Parent` within the key union `U`. */
type ChildKeys<U extends string, Parent extends string> = U extends `${Parent}.${infer C}`
  ? C
  : never;

type PickProperties<P extends TProperties, U extends string> = {
  [K in Head<U> & keyof P]: K extends U ? P[K] : TDeepPick<P[K], ChildKeys<U, K>>;
};

type OmitProperties<P extends TProperties, U extends string> = {
  [K in keyof P as K extends U ? never : K]: K extends string
    ? [ChildKeys<U, K>] extends [never]
      ? P[K]
      : TDeepOmit<P[K], ChildKeys<U, K>>
    : P[K];
};

/** Resulting schema type of {@link DeepPick}. Distributes across union variants. */
export type TDeepPick<S extends TSchema, U extends string> =
  S extends TUnion<infer Variants>
    ? TUnion<{ [I in keyof Variants]: TDeepPick<Variants[I], U> }>
    : S extends TObject<infer P>
      ? TObject<PickProperties<P, U>>
      : S;

/** Resulting schema type of {@link DeepOmit}. Distributes across union variants. */
export type TDeepOmit<S extends TSchema, U extends string> =
  S extends TUnion<infer Variants>
    ? TUnion<{ [I in keyof Variants]: TDeepOmit<Variants[I], U> }>
    : S extends TObject<infer P>
      ? TObject<OmitProperties<P, U>>
      : S;

const splitKeys = (keys: readonly string[]) => {
  const whole = new Set<string>();
  const nested = new Map<string, string[]>();
  for (const key of keys) {
    const dot = key.indexOf(".");
    if (dot === -1) {
      whole.add(key);
    } else {
      const parent = key.slice(0, dot);
      const child = key.slice(dot + 1);
      const existing = nested.get(parent);
      if (existing) {
        existing.push(child);
      } else {
        nested.set(parent, [child]);
      }
    }
  }
  return { whole, nested };
};

const deepPick = (schema: TSchema, keys: readonly string[]): TSchema => {
  if (T.IsUnion(schema)) {
    return T.Union(schema.anyOf.map((variant) => deepPick(variant, keys)));
  }
  if (!T.IsObject(schema)) {
    return schema;
  }
  const { whole, nested } = splitKeys(keys);
  const properties: Record<string, TSchema> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (whole.has(key)) {
      properties[key] = value;
    } else {
      const childKeys = nested.get(key);
      if (childKeys) {
        properties[key] = deepPick(value, childKeys);
      }
    }
  }
  return T.Object(properties);
};

const deepOmit = (schema: TSchema, keys: readonly string[]): TSchema => {
  if (T.IsUnion(schema)) {
    return T.Union(schema.anyOf.map((variant) => deepOmit(variant, keys)));
  }
  if (!T.IsObject(schema)) {
    return schema;
  }
  const { whole, nested } = splitKeys(keys);
  const properties: Record<string, TSchema> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (whole.has(key)) {
      continue;
    }
    const childKeys = nested.get(key);
    properties[key] = childKeys ? deepOmit(value, childKeys) : value;
  }
  return T.Object(properties);
};

/**
 * Like `Type.Pick`, but supports unions of objects and a single level of nested
 * properties via dot notation. Selected keys are strongly typed against the
 * schema, so invalid paths are a compile-time error. Specifying a key whose
 * value is an object selects the entire nested object.
 */
export const DeepPick = <S extends TSchema, const K extends readonly DeepKeyOf<S>[]>(
  schema: S,
  keys: K,
): TDeepPick<S, Extract<K[number], string>> => deepPick(schema, keys) as never;

/**
 * Like `Type.Omit`, but supports unions of objects and a single level of nested
 * properties via dot notation. Removed keys are strongly typed against the
 * schema, so invalid paths are a compile-time error. Specifying a key whose
 * value is an object removes the entire nested object.
 */
export const DeepOmit = <S extends TSchema, const K extends readonly DeepKeyOf<S>[]>(
  schema: S,
  keys: K,
): TDeepOmit<S, Extract<K[number], string>> => deepOmit(schema, keys) as never;
