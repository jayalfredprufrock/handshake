import type { TSchema } from "typebox";
import type { OpenAPIV3_1 } from "openapi-types";

type SchemaObject = OpenAPIV3_1.SchemaObject;
type ReferenceObject = OpenAPIV3_1.ReferenceObject;
export type Schema = SchemaObject | ReferenceObject;

/** Keywords whose value is a single nested schema. */
const SUBSCHEMA_KEYS = new Set(["items", "not", "propertyNames", "contains", "if", "then", "else"]);
/** Keywords whose value is an array of schemas. */
const SUBSCHEMA_ARRAY_KEYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
/** Keywords whose value is a record of name → schema. */
const SUBSCHEMA_RECORD_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

function sanitizeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Finishes a converted union carrying `discriminator.propertyName` (see
 * `DiscriminatedUnion`) the way OpenAPI tooling expects, matching the error responses:
 *
 * - `anyOf` becomes `oneOf`. Distinct tag literals make the variants mutually exclusive,
 *   and code generators handle `oneOf` + `discriminator` best.
 * - Each variant converted to a `$ref` (one declaring a `$id`) gets a `mapping` entry from
 *   its tag literal to that ref. Inline variants have nothing to point at, so they're
 *   left to the validator. Entries the user wrote in `mapping` take precedence.
 *
 * Anything else is returned untouched.
 */
function discriminate(source: TSchema, out: Record<string, unknown>): Record<string, unknown> {
  const discriminator = out.discriminator;
  const variants = (source as { anyOf?: unknown }).anyOf;
  if (!isPlainObject(discriminator) || !Array.isArray(variants) || !Array.isArray(out.anyOf)) {
    return out;
  }
  const prop = discriminator.propertyName;
  if (typeof prop !== "string") return out;

  const mapping: Record<string, string> = {};
  (out.anyOf as Schema[]).forEach((converted, index) => {
    const tag = (variants[index] as { properties?: Record<string, { const?: unknown }> })
      .properties?.[prop]?.const;
    if ("$ref" in converted && (typeof tag === "string" || typeof tag === "number")) {
      mapping[String(tag)] = converted.$ref;
    }
  });
  const userMapping = isPlainObject(discriminator.mapping) ? discriminator.mapping : {};
  const merged = { ...mapping, ...userMapping };

  const { anyOf, ...rest } = out;
  return {
    ...rest,
    oneOf: anyOf,
    discriminator: {
      ...discriminator,
      ...(Object.keys(merged).length > 0 && { mapping: merged }),
    },
  };
}

/**
 * Converts TypeBox schemas (JSON Schema 2020-12, which OpenAPI 3.1 accepts
 * directly) into OpenAPI schema objects, collecting any `$id`-bearing schema into
 * `components/schemas` and replacing it with a `$ref`. TypeBox's symbol-keyed
 * metadata is dropped automatically (it isn't enumerable as string keys).
 */
export class SchemaRegistry {
  readonly schemas: Record<string, SchemaObject> = {};
  private readonly inProgress = new Set<string>();

  /** Convert a schema; hoists it to `components/schemas` when it declares a `$id`. */
  convert(schema: TSchema): Schema {
    const id = (schema as { $id?: unknown }).$id;
    if (typeof id === "string" && id.length > 0) {
      const name = sanitizeName(id);
      if (!(name in this.schemas) && !this.inProgress.has(name)) {
        this.inProgress.add(name);
        this.schemas[name] = this.convertBody(schema);
        this.inProgress.delete(name);
      }
      return { $ref: `#/components/schemas/${name}` };
    }
    return this.convertBody(schema);
  }

  /** Register a pre-built schema object under a component name and return a `$ref`. */
  register(name: string, schema: SchemaObject): ReferenceObject {
    if (!(name in this.schemas)) this.schemas[name] = schema;
    return { $ref: `#/components/schemas/${name}` };
  }

  /** Convert the schema's own keywords (without hoisting it by its `$id`). */
  private convertBody(schema: TSchema): SchemaObject {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "$id") continue;
      out[key] = this.convertValue(key, value);
    }
    return discriminate(schema, out) as SchemaObject;
  }

  private convertValue(key: string, value: unknown): unknown {
    if (SUBSCHEMA_KEYS.has(key) && isPlainObject(value)) {
      return this.convert(value as TSchema);
    }
    if (SUBSCHEMA_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      return value.map((entry) => this.convert(entry as TSchema));
    }
    if (SUBSCHEMA_RECORD_KEYS.has(key) && isPlainObject(value)) {
      const mapped: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value)) mapped[name] = this.convert(sub as TSchema);
      return mapped;
    }
    if (key === "additionalProperties" && isPlainObject(value)) {
      return this.convert(value as TSchema);
    }
    return value;
  }
}
