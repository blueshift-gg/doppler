import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expandHomePath, loadSolanaCliConfig, parseSolanaCliConfig } from "../src/solana-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("parseSolanaCliConfig reads keypair_path and json_rpc_url", () => {
  const parsed = parseSolanaCliConfig(`---
json_rpc_url: https://api.devnet.solana.com
websocket_url: ''
keypair_path: ~/my-wallet.json
commitment: confirmed
`);

  expect(parsed.jsonRpcUrl).toBe("https://api.devnet.solana.com");
  expect(parsed.keypairPath).toBe("~/my-wallet.json");
});

test("expandHomePath resolves tilde-prefixed paths", () => {
  expect(expandHomePath("~/wallet.json")).toMatch(/wallet\.json$/);
  expect(expandHomePath("/abs/wallet.json")).toBe("/abs/wallet.json");
});

test("loadSolanaCliConfig loads and expands config values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-solana-config-"));
  tempDirs.push(dir);

  const configPath = join(dir, "config.yml");
  await writeFile(
    configPath,
    `json_rpc_url: https://rpc.example.com
keypair_path: ~/signer.json
`,
  );

  const config = await loadSolanaCliConfig(configPath);
  expect(config.jsonRpcUrl).toBe("https://rpc.example.com");
  expect(config.keypairPath).toMatch(/signer\.json$/);
});
