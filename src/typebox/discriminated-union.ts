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

/** Keys of an object schema whose property schema is a literal. */
type LiteralKeys<S> =
  S extends TObject<infer P>
    ? { [K in keyof P]: P[K] extends TLiteral ? K : never }[keyof P] & string
    : never;

/** Keys holding a literal in EVERY variant: the valid discriminators. */
type CommonLiteralKeys<Types extends TSchema[]> = Types extends [
  infer F extends TSchema,
  ...infer R extends TSchema[],
]
  ? R extends []
    ? LiteralKeys<F>
    : LiteralKeys<F> & CommonLiteralKeys<R>
  : string;

/**
 * Builds a union whose variants are told apart by a literal-valued property. It's a
 * compile error unless `propertyName` holds a literal in every variant.
 *
 * At runtime the server uses the tag to clean and validate a response against the one
 * matching variant instead of trying each in turn. An unknown or missing tag falls back
 * to the full union.
 *
 * Only top-level response unions get this speed-up: unions nested inside a schema are
 * cleaned by TypeBox, which still tries every variant.
 */
export function DiscriminatedUnion<
  const Types extends TObject[],
  D extends CommonLiteralKeys<Types>,
>(propertyName: D, variants: [...Types], options?: TSchemaOptions): TDiscriminatedUnion<D, Types> {
  return T.Union(variants, { ...options, discriminator: { propertyName } }) as never;
}

/** True when `schema` is a union carrying a `discriminator.propertyName`. */
export function IsDiscriminatedUnion(schema: unknown): schema is TDiscriminatedUnion {
  return (
    T.IsUnion(schema) &&
    typeof (schema as { discriminator?: { propertyName?: unknown } }).discriminator
      ?.propertyName === "string"
  );
}
