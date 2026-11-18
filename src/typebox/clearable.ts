import type { Static, TObject, TOptional, TProperties, TSchema } from "typebox";
import * as T from "typebox";
import { Memory } from "typebox/system";

/**
 * An optional property schema the client may clear by sending `null`. The `x-clearable`
 * keyword is an OpenAPI extension (an annotation to JSON Schema), so validation ignores it:
 * `null` only gets through because the server converts it before validating.
 */
export type TClearable<S extends TSchema = TSchema> = TOptional<S & { "x-clearable": true }>;

/**
 * Marks an object property as clearable: optional, and clearable by sending `null`.
 *
 * Storage never holds `null` for it. The server converts a `null` before validation:
 *
 * - in a PATCH body, to a present `undefined` key, which repositories read as "remove";
 * - in any other body, to an absent key, so server-side defaults apply.
 *
 * Only top-level body properties are converted, since patches are shallow. A schema that
 * already admits `null` (`Union` with `Null`, `Unknown`, `Any`) keeps `null` as a value.
 */
export function Clearable<S extends TSchema>(schema: S): TClearable<S> {
  // `Memory.Update`, not a spread: a spread drops TypeBox's non-enumerable `~kind` tag.
  return T.Optional(Memory.Update(schema, {}, { "x-clearable": true }) as S) as never;
}

/**
 * True for an optional schema carrying `x-clearable: true`. `Type.Required` keeps the
 * keyword but removes optional, and a required property can't be cleared, so both count.
 */
export function IsClearable(schema: unknown): schema is TClearable {
  return T.IsOptional(schema) && (schema as { "x-clearable"?: unknown })["x-clearable"] === true;
}

/** True when `null` is a valid value for `schema` on its own terms. */
export function AdmitsNull(schema: TSchema): boolean {
  if (T.IsNull(schema) || T.IsUnknown(schema) || T.IsAny(schema)) return true;
  return T.IsUnion(schema) && schema.anyOf.some(AdmitsNull);
}

/** Keys of an object schema's properties that are {@link Clearable}. */
export type ClearableKeys<S> =
  S extends TObject<infer P extends TProperties>
    ? { [K in keyof P]: P[K] extends TClearable ? K : never }[keyof P]
    : never;

/**
 * What a client may send for a body schema: its `Static`, with every clearable property
 * widened to also accept `null`. Handlers still see the plain `Static`, because the server
 * has converted the `null` by then.
 */
export type StaticClearable<S extends TSchema> = [ClearableKeys<S>] extends [never]
  ? Static<S>
  : { [K in keyof Static<S>]: K extends ClearableKeys<S> ? Static<S>[K] | null : Static<S>[K] };
