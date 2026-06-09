import { createLibraryConfig } from "../rolldown.shared";

export default createLibraryConfig({
  input: "./src/index.ts",
  external: [/^@solana\//, "@solana/web3.js"],
});
