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
 * Validate a payload schema object and normalize each field to a scalar type and length.
 *
 * Scalar fields become length `1`; array fields must declare a positive integer `length`.
 */
export function normalizePayloadSchema(schema: unknown): NormalizedField[] {
  if (!isRecord(schema) || Array.isArray(schema)) {
    throw new Error("Payload schema must be an object");
  }

  const fields: NormalizedField[] = [];
  for (const [name, field] of Object.entries(schema)) {
    if (!FIELD_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid payload field name: ${name}`);
    }

    if (isScalarType(field)) {
      fields.push({ name, type: field, length: 1 });
      continue;
    }

    if (!isRecord(field) || Array.isArray(field)) {
      throw new Error(`Invalid schema for field '${name}'`);
    }

    if (!isScalarType(field.type)) {
      throw new Error(`Invalid scalar type for field '${name}'`);
    }

    const length = field.length;
    if (typeof length !== "number" || !Number.isInteger(length) || length <= 0) {
      throw new Error(`Array field '${name}' must have a positive integer length`);
    }

    fields.push({ name, type: field.type, length });
  }

  if (fields.length === 0) {
    throw new Error("Payload schema must contain at least one field");
  }

  return fields;
}

/** Convert normalized fields back into the shorthand payload schema object shape. */
export function normalizedSchemaObject(fields: NormalizedField[]): PayloadSchema {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.length === 1 ? field.type : { type: field.type, length: field.length },
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
