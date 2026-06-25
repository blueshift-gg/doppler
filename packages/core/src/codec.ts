import {
  getArrayCodec,
  getBooleanCodec,
  getI16Codec,
  getI32Codec,
  getI64Codec,
  getI8Codec,
  getStructCodec,
  getU16Codec,
  getU32Codec,
  getU64Codec,
  getU8Codec,
  type FixedSizeCodec,
} from "@solana/codecs";

import { SCALAR_CODEC_FACTORY_NAMES } from "./codec-metadata.js";
import { computePayloadLayout } from "./layout.js";
import type { PayloadSchema, ScalarType } from "./schema.js";

export type PayloadValue = bigint | number | boolean | bigint[] | number[] | boolean[];
export type PayloadRecord = Record<string, PayloadValue>;
type PayloadFieldCodec = FixedSizeCodec<any>;
type ScalarCodecFactoryName = (typeof SCALAR_CODEC_FACTORY_NAMES)[ScalarType];

const SCALAR_CODEC_FACTORIES = {
  getU8Codec,
  getU16Codec,
  getU32Codec,
  getU64Codec,
  getI8Codec,
  getI16Codec,
  getI32Codec,
  getI64Codec,
  getBooleanCodec,
} as const satisfies Record<ScalarCodecFactoryName, () => PayloadFieldCodec>;

/** Build a FixedSizeCodec from a Doppler payload schema. */
export function buildPayloadCodec(schema: PayloadSchema): FixedSizeCodec<PayloadRecord> {
  const layout = computePayloadLayout(schema);
  const entries = layout.fields.map((field) => {
    const baseCodec = getScalarCodec(field.type);
    const codec =
      field.length === 1
        ? baseCodec
        : (getArrayCodec(baseCodec, { size: field.length }) as PayloadFieldCodec);

    return [field.name, codec] as const;
  });

  return getStructCodec(entries) as unknown as FixedSizeCodec<PayloadRecord>;
}

function getScalarCodec(type: ScalarType): PayloadFieldCodec {
  return SCALAR_CODEC_FACTORIES[SCALAR_CODEC_FACTORY_NAMES[type]]();
}
