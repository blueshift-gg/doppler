import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

export default defineConfig({
  input: {
    cli: "./src/cli.ts",
  },
  external: [
    "@blueshift-gg/doppler",
    "@solana/web3.js",
    "commander",
    "jiti",
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
  platform: "node",
});
