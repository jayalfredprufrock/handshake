import type { TSchema } from "typebox";

/**
 * How a node's own `additionalProperties` is decided.
 *
 * - `"default"` — set `false` only where the author declared nothing. An explicit value
 *   (including `true`, or a schema constraining the extras) is preserved. Used for request
 *   data: an open body is the author's deliberate choice and only widens what the client
 *   may send.
 * - `"force"` — always set `false`, overriding whatever the author declared. Used for
 *   responses, where an open schema means the server leaks properties it never intended to
 *   publish. There is no legitimate reason to send undeclared data to a client, and
 *   response handling strips rather than rejects, so overriding cannot break a caller.
 */
export type CloseMode = "default" | "force";

export interface CloseOptions {
  mode?: CloseMode;
  /**
   * Drop `$id` from nodes whose closed form depends on the mode, so OpenAPI generation
   * cannot hoist one into `components/schemas` and have a request and a response disagree
   * about the same component. See {@link divergesBetweenModes}. Never set for runtime
   * validation, where `$id` must stay intact.
   */
  dropSharedIds?: boolean;
}

/** Keywords whose value is a single nested schema. */
const SUBSCHEMA_KEYS = new Set(["items", "not", "propertyNames", "contains", "if", "then", "else"]);
/** Keywords whose value is an array of schemas (excluding the composition keywords). */
const SUBSCHEMA_ARRAY_KEYS = new Set(["prefixItems"]);
/** Keywords whose value is a record of name → schema. */
const SUBSCHEMA_RECORD_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

function isSchemaObject(value: unknown): value is TSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copies a schema, applying `patch`, while preserving NON-ENUMERABLE own properties.
 *
 * TypeBox v1 tags every schema with a non-enumerable `~kind`. Object spread and rest
 * destructuring copy only enumerable own properties, so `{ ...schema }` silently drops that
 * tag — and a schema without it loses TypeBox's kind-aware paths: `Convert` stops coercing
 * and `Clean` stops stripping, both silently. Descriptor-level cloning is what keeps a
 * modified schema behaving like a real TypeBox schema.
 */
function cloneWith(schema: TSchema, patch: Record<string, unknown>): TSchema {
  const next = Object.create(
    Object.getPrototypeOf(schema),
    Object.getOwnPropertyDescriptors(schema),
  ) as TSchema;
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(next, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return next;
}

function withoutId(schema: TSchema): TSchema {
  if (!("$id" in schema)) return schema;
  const next = cloneWith(schema, {});
  delete (next as { $id?: unknown }).$id;
  return next;
}

/**
 * True when `"default"` and `"force"` would produce different `additionalProperties` for
 * this node — i.e. it declares an explicit value other than `false`. Such a node is closed
 * as a response but left as declared as a request, so it cannot be a shared component.
 */
function divergesBetweenModes(schema: TSchema): boolean {
  return (
    "additionalProperties" in schema &&
    (schema as { additionalProperties?: unknown }).additionalProperties !== false
  );
}

/**
 * `closeRoot` is false only for `allOf` members. `additionalProperties` consults just its
 * own sibling `properties`, so closing intersect members independently makes the
 * intersection unsatisfiable rather than strict: `{a, b}` would fail the `{a}` member for
 * carrying `b` and the `{b}` member for carrying `a`. Their nested objects are still
 * walked — only the members' own roots are left open.
 */
function walk(schema: TSchema, options: Required<CloseOptions>, closeRoot: boolean): TSchema {
  if (!isSchemaObject(schema)) return schema;

  const patch: Record<string, unknown> = {};
  const hasOwnValue = "additionalProperties" in schema;
  const isObjectNode = Boolean((schema as { properties?: unknown }).properties);
  const close = closeRoot && isObjectNode && (options.mode === "force" || !hasOwnValue);
  if (close && (schema as { additionalProperties?: unknown }).additionalProperties !== false) {
    patch.additionalProperties = false;
  }

  for (const [key, value] of Object.entries(schema)) {
    // Already being replaced with `false`; no point walking the schema it used to hold.
    if (key === "additionalProperties" && "additionalProperties" in patch) continue;

    if (key === "anyOf" || key === "oneOf" || key === "allOf") {
      if (!Array.isArray(value)) continue;
      const members = value as TSchema[];
      const mapped = members.map((member) => walk(member, options, key !== "allOf"));
      if (mapped.some((member, index) => member !== members[index])) patch[key] = mapped;
      continue;
    }
    if (SUBSCHEMA_RECORD_KEYS.has(key) && isSchemaObject(value)) {
      const entries = Object.entries(value as Record<string, TSchema>);
      const mapped: Record<string, unknown> = {};
      let changed = false;
      for (const [name, sub] of entries) {
        const next = walk(sub, options, true);
        mapped[name] = next;
        if (next !== sub) changed = true;
      }
      if (changed) patch[key] = mapped;
      continue;
    }
    if (SUBSCHEMA_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      const members = value as TSchema[];
      const mapped = members.map((member) => walk(member, options, true));
      if (mapped.some((member, index) => member !== members[index])) patch[key] = mapped;
      continue;
    }
    if ((SUBSCHEMA_KEYS.has(key) || key === "additionalProperties") && isSchemaObject(value)) {
      const next = walk(value as TSchema, options, true);
      if (next !== value) patch[key] = next;
    }
  }

  // A diverging node must shed its `$id` even when nothing else changed — otherwise the
  // request's untouched schema and the response's closed one race for the same component.
  const shedId = options.dropSharedIds && divergesBetweenModes(schema);
  if (Object.keys(patch).length === 0) return shedId ? withoutId(schema) : schema;
  const next = cloneWith(schema, patch);
  return shedId ? withoutId(next) : next;
}

/**
 * Recursively defaults `additionalProperties` to `false` on every object node (one
 * declaring `properties`), so strictness holds at all depths rather than only at the root.
 *
 * Nodes without `properties` are left alone: `Type.Record` (which uses `patternProperties`)
 * and `Type.Unknown`/`Type.Any` stay open, and remain the way to model genuinely dynamic
 * payloads. Returns the original reference when nothing changed.
 *
 * Note that TypeBox itself is permissive: an object schema with no `additionalProperties`
 * accepts extra keys. Strictness comes from this function, not from TypeBox.
 *
 * Consumed by request/response validation (`src/server/parse.ts`) and OpenAPI generation
 * (`src/openapi/index.ts`) so the published spec advertises exactly what the server
 * enforces. `src/utils/` intentionally has NO `index.ts` and is not a package entrypoint:
 * every other source directory is published via an `export *` barrel, and adding this to
 * one would put it in the public API and drag it into the browser bundle of every consumer
 * that imports a contract.
 */
export function closeProperties(schema: TSchema, options: CloseOptions = {}): TSchema {
  return walk(
    schema,
    { mode: options.mode ?? "default", dropSharedIds: options.dropSharedIds ?? false },
    true,
  );
}
