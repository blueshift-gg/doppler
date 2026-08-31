import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

export default defineConfig({
  input: {
    index: "./src/index.ts",
  },
  external: ["@solana/codecs"],
  plugins: [dts()],
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].js",
    cleanDir: true,
  },
  platform: "neutral",
});
