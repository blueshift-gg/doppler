import type { ScalarType } from "./schema.js";

export const SCALAR_CODEC_FACTORY_NAMES = {
  u8: "getU8Codec",
  u16: "getU16Codec",
  u32: "getU32Codec",
  u64: "getU64Codec",
  i8: "getI8Codec",
  i16: "getI16Codec",
  i32: "getI32Codec",
  i64: "getI64Codec",
  bool: "getBooleanCodec",
} as const satisfies Record<ScalarType, string>;

export const SCALAR_TYPESCRIPT_TYPES = {
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "bigint",
  i8: "number",
  i16: "number",
  i32: "number",
  i64: "bigint",
  bool: "boolean",
} as const satisfies Record<ScalarType, string>;
