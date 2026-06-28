import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadGeneratorConfig } from "../src/config.js";
import { writeDopplerArtifacts } from "../src/emit.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("emits requested artifacts", async () => {
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
  const binaryFile = join(dir, "out", "doppler.so");
  const manifest = await writeDopplerArtifacts(config, {
    binaryFile,
    assemblyFile: join(dir, "out", "doppler.s"),
  });

  expect(manifest.arch).toBe("v3");
  expect(manifest.payloadSize).toBe(8);
  expect(existsSync(binaryFile)).toBe(true);
  expect(existsSync(join(dir, "out", "doppler.s"))).toBe(true);
  expect(existsSync(join(dir, "out", "manifest.json"))).toBe(true);
});
