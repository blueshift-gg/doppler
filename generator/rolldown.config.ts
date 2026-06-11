import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

export default defineConfig({
  input: {
    index: "./src/index.ts",
    cli: "./src/cli.ts",
  },
  external: [
    "@blueshift-gg/sbpf-assembler",
    "@solana-program/loader-v3",
    "@solana/codecs",
    "@solana/compat",
    "@solana/kit",
    "@solana/web3.js",
    "bs58",
    "commander",
    "jiti",
    "node:child_process",
    "node:crypto",
    "node:fs",
    "node:fs/promises",
    "node:os",
    "node:path",
    "node:url",
  ],
  plugins: [dts()],
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    cleanDir: true,
  },
});
