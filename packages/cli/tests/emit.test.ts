import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    typescriptSdkDir: join(dir, "out", "codec"),
    rustSdkDir: join(dir, "out", "rust"),
  });

  expect(manifest.arch).toBe("v3");
  expect(manifest.payloadSize).toBe(8);
  expect(existsSync(binaryFile)).toBe(true);
  expect(existsSync(join(dir, "out", "doppler.s"))).toBe(true);
  expect(existsSync(join(dir, "out", "manifest.json"))).toBe(true);
  expect(existsSync(join(dir, "out", "codec", "src", "codecs.ts"))).toBe(true);
  expect(existsSync(join(dir, "out", "rust", "src", "lib.rs"))).toBe(true);

  const codecPackageJson = JSON.parse(
    await readFile(join(dir, "out", "codec", "package.json"), "utf8"),
  );
  expect(codecPackageJson.name).toBe("price-feed-codec");
  expect(codecPackageJson.dependencies).toEqual({ "@solana/codecs": "^6.9.0" });

  const codecsSource = await readFile(join(dir, "out", "codec", "src", "codecs.ts"), "utf8");
  expect(codecsSource).toContain("export interface PriceFeedPayload");
  expect(codecsSource).toContain("export const priceFeedCodec");
});

test("writes the TypeScript codec package directly to the requested directory", async () => {
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
  const out = join(dir, "out", "typescript");
  await writeDopplerArtifacts(config, {
    binaryFile: join(dir, "out", "doppler.so"),
    typescriptSdkDir: out,
  });

  expect(existsSync(join(out, "package.json"))).toBe(true);
  expect(existsSync(join(out, "src", "codecs.ts"))).toBe(true);
  expect(existsSync(join(dir, "out", "package.json"))).toBe(false);
});
