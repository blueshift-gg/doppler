import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

export default defineConfig({
  input: {
    index: "./src/index.ts",
  },
  resolve: {
    conditionNames: ["import", "node", "default"],
  },
  external: [
    "@solana-program/loader-v3",
    "@solana/compat",
    "@solana/kit",
    "@solana/web3.js",
    "bs58",
  ],
  plugins: [dts({ eager: true })],
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    cleanDir: true,
  },
  platform: "neutral",
});
