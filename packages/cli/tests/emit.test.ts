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
  const bytecodeFile = join(dir, "out", "doppler.so");
  const manifest = await writeDopplerArtifacts(config, {
    bytecodeFile,
    assemblyFile: join(dir, "out", "doppler.s"),
    web3jsSdkDir: join(dir, "out", "web3js"),
    kitSdkDir: join(dir, "out", "kit"),
    rustSdkDir: join(dir, "out", "rust"),
  });

  expect(manifest.arch).toBe("v3");
  expect(manifest.payloadSize).toBe(8);
  expect(existsSync(bytecodeFile)).toBe(true);
  expect(existsSync(join(dir, "out", "doppler.s"))).toBe(true);
  expect(existsSync(join(dir, "out", "manifest.json"))).toBe(true);
  expect(existsSync(join(dir, "out", "core", "src", "serializers.ts"))).toBe(true);
  expect(existsSync(join(dir, "out", "web3js", "src", "doppler.ts"))).toBe(true);
  expect(existsSync(join(dir, "out", "kit", "src", "doppler.ts"))).toBe(true);
  expect(existsSync(join(dir, "out", "rust", "src", "lib.rs"))).toBe(true);

  const workspacePackageJson = JSON.parse(await readFile(join(dir, "out", "package.json"), "utf8"));
  expect(workspacePackageJson).toEqual({
    private: true,
    workspaces: ["core", "web3js", "kit"],
    devDependencies: {
      rolldown: "1.1.0",
      "rolldown-plugin-dts": "0.25.2",
      typescript: "6.0.3",
    },
    packageManager: "bun@1.3.14",
  });
});

test("uses generated TypeScript SDK directory names in workspace package", async () => {
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
  const out = join(dir, "out");
  await writeDopplerArtifacts(config, {
    bytecodeFile: join(out, "doppler.so"),
    web3jsSdkDir: join(out, "web3.js"),
  });

  const workspacePackageJson = JSON.parse(await readFile(join(out, "package.json"), "utf8"));
  expect(workspacePackageJson.workspaces).toEqual(["core", "web3.js"]);
});
