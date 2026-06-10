import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

export default defineConfig({
  input: {
    index: "./src/index.ts",
    cli: "./src/cli.ts",
  },
  external: [
    "@blueshift-gg/sbpf-assembler",
    "@solana/codecs",
    "@solana/web3.js",
    "bs58",
    "commander",
    "jiti",
    "node:crypto",
    "node:fs/promises",
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
