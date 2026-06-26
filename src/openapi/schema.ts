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
    return out as SchemaObject;
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
