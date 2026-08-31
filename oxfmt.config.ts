import { defineConfig } from "oxfmt";

export default defineConfig({
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  sortImports: true,
  sortTailwindcss: true,
  sortPackageJson: false,
  ignorePatterns: [".agents", "examples/accounts", "examples/keys"],
});
