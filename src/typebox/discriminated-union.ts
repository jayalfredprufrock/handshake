import type { TLiteral, TObject, TSchema, TSchemaOptions, TUnion } from "typebox";
import * as T from "typebox";

/**
 * A union of object schemas tagged with the property that tells its variants apart.
 * Same JSON Schema as a plain `TUnion` plus OpenAPI's `discriminator` keyword, so tools
 * can overload on it to treat discriminated unions specially at compile time.
 */
export type TDiscriminatedUnion<
  D extends string = string,
  Types extends TSchema[] = TSchema[],
> = TUnion<Types> & { discriminator: { propertyName: D } };

/**
 * What a discriminated union may hold: an object, or a union of the same, so variant groups
 * compose (`T.Union([Electronic, Manual])`).
 */
export type UnionMember = TObject | TUnion<UnionMember[]>;

/** Every object variant of a union schema type, with nested unions flattened away. */
export type UnionVariants<T> =
  T extends TUnion<infer V> ? UnionVariants<V[number]> : T extends TObject ? T : never;

/**
 * A variant list with nested unions spliced in place, as a tuple: the type-level counterpart of
 * `variants.flatMap(flattenVariants)`. A tuple because TypeBox's `Static` only resolves a
 * union's members from a tuple.
 */
export type FlattenVariants<V extends TSchema[]> = V extends [
  infer F extends TSchema,
  ...infer R extends TSchema[],
]
  ? [...(F extends TUnion<infer N> ? FlattenVariants<N> : [F]), ...FlattenVariants<R>]
  : [];

/** Keys of an object schema whose property schema is a literal. */
type LiteralKeys<S> =
  S extends TObject<infer P>
    ? { [K in keyof P]: P[K] extends TLiteral ? K : never }[keyof P] & string
    : never;

/** Keys holding a literal in EVERY variant of a union of objects: the valid discriminators. */
type CommonLiteralKeys<S> = (S extends any ? (k: LiteralKeys<S>) => void : never) extends (
  k: infer K,
) => void
  ? K & string
  : never;

/**
 * Builds a union whose variants are told apart by a literal-valued property. It's a
 * compile error unless `propertyName` holds a literal in every (leaf) variant. Variant groups
 * (`T.Union([...])`) are flattened, so the built schema's `anyOf` is always a flat list of
 * objects.
 *
 * At runtime the server uses the tag to clean and validate a response against the one
 * matching variant instead of trying each in turn. An unknown or missing tag falls back
 * to the full union.
 *
 * Only top-level response unions get this speed-up: unions nested inside a schema are
 * cleaned by TypeBox, which still tries every variant.
 */
export function DiscriminatedUnion<
  const V extends UnionMember[],
  D extends CommonLiteralKeys<UnionVariants<V[number]>>,
>(
  propertyName: D,
  variants: [...V],
  options?: TSchemaOptions,
): TDiscriminatedUnion<D, FlattenVariants<V>> {
  return T.Union(variants.flatMap(flattenVariants), {
    ...options,
    discriminator: { propertyName },
  }) as never;
}

/** Every object variant of a schema, with nested unions flattened away. */
export function flattenVariants(schema: TSchema): TObject[] {
  return T.IsUnion(schema) ? schema.anyOf.flatMap(flattenVariants) : [schema as TObject];
}

/** True when `schema` is a union carrying a `discriminator.propertyName`. */
export function IsDiscriminatedUnion(schema: unknown): schema is TDiscriminatedUnion {
  return (
    T.IsUnion(schema) &&
    typeof (schema as { discriminator?: { propertyName?: unknown } }).discriminator
      ?.propertyName === "string"
  );
}
