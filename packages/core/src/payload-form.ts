import type { PayloadRecord, PayloadValue } from "./codec.js";
import { normalizePayloadSchema } from "./schema.js";
import type { NormalizedField, PayloadSchema } from "./schema.js";

export type PayloadFormValues = Record<string, string>;

export function defaultPayloadFormValues(schema: PayloadSchema): PayloadFormValues {
  return Object.fromEntries(
    normalizePayloadSchema(schema).map((field) => [field.name, defaultFormValue(field)]),
  );
}

export function parsePayloadFormValues(
  schema: PayloadSchema,
  values: PayloadFormValues,
): PayloadRecord {
  const payload: PayloadRecord = {};

  for (const field of normalizePayloadSchema(schema)) {
    const raw = values[field.name] ?? "";
    payload[field.name] =
      field.length === 1
        ? parseScalarPayloadValue(field.type, raw)
        : parseArrayPayloadValue(field, raw);
  }

  return payload;
}

export function formatPayloadForDisplay(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function defaultFormValue(field: NormalizedField): string {
  const scalarDefault = field.type === "bool" ? "false" : "0";
  return field.length === 1
    ? scalarDefault
    : Array.from({ length: field.length }, () => scalarDefault).join(",");
}

function parseArrayPayloadValue(field: NormalizedField, raw: string): PayloadValue {
  const parts = raw.split(",").map((part) => part.trim());

  if (parts.length !== field.length) {
    throw new Error(`Field '${field.name}' requires ${field.length} values, got ${parts.length}`);
  }

  return parts.map((part) => parseScalarPayloadValue(field.type, part)) as PayloadValue;
}

function parseScalarPayloadValue(type: NormalizedField["type"], raw: string): PayloadValue {
  switch (type) {
    case "u64":
    case "i64":
      return BigInt(raw);
    case "bool":
      return raw === "true";
    case "u8":
    case "u16":
    case "u32":
    case "i8":
    case "i16":
    case "i32":
      return Number(raw);
  }
}
