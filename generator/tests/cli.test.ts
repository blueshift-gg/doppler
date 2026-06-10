import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "bun:test";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("CLI prints help by default", async () => {
  const result = await runCli([]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: doppler-generator");
  expect(result.stdout).toContain("generate");
  expect(result.stdout).toContain("init");
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

test("generate writes keypair files when schema omits program ID and admin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-cli-"));
  tempDirs.push(dir);

  const schemaFile = join(dir, "price-feed.payload.ts");
  const keysDir = join(dir, "keys");
  await Bun.write(
    schemaFile,
    `export default {
  name: "price-feed",
  payload: {
    price: "u64",
  },
} as const;
`,
  );

  const result = await runCli([
    "generate",
    schemaFile,
    "--bytecode",
    join(dir, "doppler.so"),
    "--keys-dir",
    keysDir,
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Generated program keypair:");
  expect(result.stdout).toContain("Generated admin keypair:");
  expect(existsSync(join(keysDir, "price-feed-program-keypair.json"))).toBe(true);
  expect(existsSync(join(keysDir, "price-feed-admin-keypair.json"))).toBe(true);
  expect(existsSync(join(dir, "doppler.so"))).toBe(true);
  expect(existsSync(join(dir, "manifest.json"))).toBe(true);
});

async function runCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const command = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);

  return { exitCode, stdout, stderr };
}
