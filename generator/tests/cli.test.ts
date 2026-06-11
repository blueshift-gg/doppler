import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "bun:test";
import { createCommand } from "../src/cli";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("createCommand help lists commands in workflow order", () => {
  const help = createCommand().helpInformation();
  const initIndex = help.indexOf("init");
  const generateIndex = help.indexOf("generate");
  const deployIndex = help.indexOf("deploy");

  expect(initIndex).toBeGreaterThan(-1);
  expect(generateIndex).toBeGreaterThan(initIndex);
  expect(deployIndex).toBeGreaterThan(generateIndex);
});

test("CLI prints help by default", async () => {
  const result = await runCli([]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: doppler-generator");
  expect(result.stdout).toContain("generate");
  expect(result.stdout).toContain("init");
  expect(result.stdout).toContain("deploy");
});

test("deploy requires program keypair and admin flags", async () => {
  const result = await runCli(["deploy", "./price-feed.so"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("--program-keypair");
  expect(result.stderr).toContain("--admin");
});

test("init writes schema and generated keypair files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-cli-"));
  tempDirs.push(dir);

  const schemaFile = join(dir, "price-feed.payload.ts");
  const keysDir = join(dir, "keys");
  const result = await runCli([
    "init",
    "price-feed",
    "--out",
    schemaFile,
    "--keys-dir",
    keysDir,
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`Created schema: ${schemaFile}`);
  expect(result.stdout).toContain("Generated program keypair:");
  expect(result.stdout).toContain("Generated admin keypair:");
  expect(existsSync(schemaFile)).toBe(true);
  expect(existsSync(join(keysDir, "price-feed-program-keypair.json"))).toBe(true);
  expect(existsSync(join(keysDir, "price-feed-admin-keypair.json"))).toBe(true);

  const schema = await readFile(schemaFile, "utf8");
  expect(schema).toContain('name: "price-feed"');
  expect(schema).toContain('payload: {');

  const programKeypair = JSON.parse(
    await readFile(join(keysDir, "price-feed-program-keypair.json"), "utf8"),
  ) as number[];
  expect(programKeypair).toHaveLength(64);
});

test("generate logs optional SDK output directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-cli-"));
  tempDirs.push(dir);

  const schemaFile = "delta.payload.ts";
  await Bun.write(
    join(dir, schemaFile),
    `export default {
  name: "delta",
  programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
  admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
  payload: { price: "u64" },
} as const;
`,
  );

  const result = await runCli(
    [
      "generate",
      schemaFile,
      "--web3js-sdk",
      "sdk/web3js",
      "--kit-sdk",
      "sdk/kit",
      "--rust-sdk",
      "sdk/rust",
    ],
    {
      cwd: dir,
      cli: join(new URL("..", import.meta.url).pathname, "src/cli.ts"),
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Web3.js SDK: sdk/web3js");
  expect(result.stdout).toContain("Kit SDK: sdk/kit");
  expect(result.stdout).toContain("Rust SDK: sdk/rust");
});

test("generate writes keypair files when schema omits program ID and admin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-cli-"));
  tempDirs.push(dir);

  const schemaFile = "price-feed.payload.ts";
  const keysDir = "keys";
  await Bun.write(
    join(dir, schemaFile),
    `export default {
  name: "price-feed",
  payload: {
    price: "u64",
  },
} as const;
`,
  );

  const result = await runCli(["generate", schemaFile, "--keys-dir", keysDir], {
    cwd: dir,
    cli: join(new URL("..", import.meta.url).pathname, "src/cli.ts"),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Generated program keypair:");
  expect(result.stdout).toContain("Generated admin keypair:");
  expect(result.stdout).toContain("Compiled bytecode: ./price-feed.so");
  expect(existsSync(join(dir, keysDir, "price-feed-program-keypair.json"))).toBe(true);
  expect(existsSync(join(dir, keysDir, "price-feed-admin-keypair.json"))).toBe(true);
  expect(existsSync(join(dir, "price-feed.so"))).toBe(true);
  expect(existsSync(join(dir, "manifest.json"))).toBe(true);
});

async function runCli(
  args: string[],
  options: { cwd?: string; cli?: string } = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const generatorDir = new URL("..", import.meta.url).pathname;
  const command = Bun.spawn(
    ["bun", "run", options.cli ?? "src/cli.ts", ...args],
    {
      cwd: options.cwd ?? generatorDir,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);

  return { exitCode, stdout, stderr };
}
