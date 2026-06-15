import { SCALAR_SIZES, normalizePayloadSchema } from "./schema.js";
import type { NormalizedField } from "./schema.js";

export type LayoutField = NormalizedField & {
  offset: number;
  size: number;
};

export type PayloadLayout = {
  fields: LayoutField[];
  payloadSize: number;
};

/** Assign contiguous byte offsets to each field in a normalized payload schema. */
export function computePayloadLayout(schema: unknown): PayloadLayout {
  const fields = normalizePayloadSchema(schema);
  let offset = 0;

  const layoutFields = fields.map((field) => {
    const size = SCALAR_SIZES[field.type] * field.length;
    const layoutField: LayoutField = {
      ...field,
      offset,
      size,
    };
    offset += size;
    return layoutField;
  });

  return {
    fields: layoutFields,
    payloadSize: offset,
  };
}
