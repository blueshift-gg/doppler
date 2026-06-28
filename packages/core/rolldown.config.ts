import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

export default defineConfig({
  input: {
    index: "./src/index.ts",
  },
  external: [
    /^@blueshift-gg\/sbpf-assembler/,
    "@solana-program/loader-v3",
    "@solana/codecs",
    "@solana/compat",
    "@solana/kit",
    "@solana/web3.js",
    "bs58",
  ],
  plugins: [dts()],
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    cleanDir: true,
  },
  platform: "neutral",
});
