import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "bun:test";
import { loadGeneratorConfig } from "../src/config.js";
import { generateDopplerArtifacts } from "../src/emit.js";

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
  const bytecodeFile = join(dir, "out", "doppler.so");
  const manifest = await generateDopplerArtifacts(config, {
    bytecodeFile,
    assemblyFile: join(dir, "out", "doppler.s"),
    tsSdkDir: join(dir, "out", "ts"),
    rustSdkDir: join(dir, "out", "rust"),
  });

  expect(manifest.arch).toBe("v3");
  expect(manifest.payloadSize).toBe(8);
  expect(existsSync(bytecodeFile)).toBe(true);
  expect(existsSync(join(dir, "out", "doppler.s"))).toBe(true);
  expect(existsSync(join(dir, "out", "manifest.json"))).toBe(true);
  expect(existsSync(join(dir, "out", "ts", "serializers.ts"))).toBe(true);
  expect(existsSync(join(dir, "out", "rust", "src/lib.rs"))).toBe(true);
});
