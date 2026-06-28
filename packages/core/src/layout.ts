import {
  SCALAR_SIZES,
  normalizePayloadSchema,
  type NormalizedField,
} from "@blueshift-gg/doppler-codec";

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

  const layoutFields: LayoutField[] = [];
  let offset = 0;

  for (const field of fields) {
    const size = SCALAR_SIZES[field.type] * field.length;
    layoutFields.push({ ...field, offset, size });
    offset += size;
  }

  return {
    fields: layoutFields,
    payloadSize: offset,
  };
}
