export const SCALAR_TYPES = ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "bool"] as const;

export type ScalarType = (typeof SCALAR_TYPES)[number];

export type ArrayFieldSchema = {
  type: ScalarType;
  length: number;
};

export type FieldSchema = ScalarType | ArrayFieldSchema;

export type PayloadSchema = Record<string, FieldSchema>;

export type NormalizedField = {
  name: string;
  type: ScalarType;
  length: number;
};

export const SCALAR_SIZES: Record<ScalarType, number> = {
  u8: 1,
  u16: 2,
  u32: 4,
  u64: 8,
  i8: 1,
  i16: 2,
  i32: 4,
  i64: 8,
  bool: 1,
};

const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Return whether `value` is a supported scalar payload field type. */
export function isScalarType(value: unknown): value is ScalarType {
  return typeof value === "string" && SCALAR_TYPES.includes(value as ScalarType);
}

/**
 * Validate a payload schema object and normalize each field to `{ name, type, length }`.
 *
 * Each field accepts one of two shapes:
 * - `"u32"` — scalar shorthand (length = 1)
 * - `{ type: "u32", length: 10 }` — array descriptor
 */
export function normalizePayloadSchema(schema: unknown): NormalizedField[] {
  if (!isRecord(schema)) {
    throw new Error("Payload schema must be an object");
  }

  const entries = Object.entries(schema);

  if (entries.length === 0) {
    throw new Error("Payload schema must contain at least one field");
  }

  return entries.map(([name, field]) => normalizeField(name, field));
}

function normalizeField(name: string, field: unknown): NormalizedField {
  if (!FIELD_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid payload field name: ${name}`);
  }

  let type: unknown;
  let length: unknown;

  if (typeof field === "string") {
    type = field;
    length = 1;
  } else if (isRecord(field)) {
    type = field.type;
    length = field.length;
  } else {
    throw new Error(`Invalid schema for field '${name}'`);
  }

  if (!isScalarType(type)) {
    throw new Error(`Invalid scalar type '${String(type)}' for field '${name}'`);
  }

  if (typeof length !== "number" || !Number.isInteger(length) || length <= 0) {
    throw new Error(`Field '${name}' length must be a positive integer`);
  }

  return { name, type, length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
