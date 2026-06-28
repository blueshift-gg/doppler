/** @type {import("lint-staged").Configuration} */
export default {
  "*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}": ["bun run lint:fix", "bun run fmt:fix"],
  "*.md": "bun run fmt:fix",
  "*.rs": (files) => `cargo fmt -- ${files.join(" ")}`,
};
