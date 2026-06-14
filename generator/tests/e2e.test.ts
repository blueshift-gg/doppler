import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadGeneratorConfig } from "../src/config.js";
import { generateDopplerArtifacts } from "../src/emit.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("generates price feed artifacts with default v3 arch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-"));
  tempDirs.push(dir);
  const configFile = join(dir, "payload.json");
  await writeFile(
    configFile,
    JSON.stringify({
      name: "price-feed",
      programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
      admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
      payload: { price: "u64" },
    }),
  );

  const config = await loadGeneratorConfig(configFile);
  const out = join(dir, "generated");
  const manifest = await generateDopplerArtifacts(config, {
    bytecodeFile: join(out, "doppler.so"),
    assemblyFile: join(out, "doppler.s"),
    web3jsSdkDir: join(out, "web3js"),
  });

  expect(manifest.arch).toBe("v3");
  expect(manifest.payloadSize).toBe(8);
  expect(existsSync(join(out, "doppler.so"))).toBe(true);
  expect(existsSync(join(out, "doppler.s"))).toBe(true);
  expect(existsSync(join(out, "manifest.json"))).toBe(true);
  expect(existsSync(join(out, "core", "src", "serializers.ts"))).toBe(true);
  expect(existsSync(join(out, "web3js", "src", "doppler.ts"))).toBe(true);
});

test("supports explicit v0 arch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-"));
  tempDirs.push(dir);
  const configFile = join(dir, "payload.json");
  await writeFile(
    configFile,
    JSON.stringify({
      name: "price-feed",
      programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
      admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
      arch: "v0",
      payload: { price: "u64" },
    }),
  );

  const config = await loadGeneratorConfig(configFile);
  const manifest = await generateDopplerArtifacts(config, {
    bytecodeFile: join(dir, "doppler.so"),
  });

  expect(manifest.arch).toBe("v0");
});
