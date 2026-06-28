import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCommand } from "../src/cli";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("createCommand help lists commands in workflow order", () => {
  const help = createCommand().helpInformation();
  const initIndex = help.indexOf("  init ");
  const generateIndex = help.indexOf("  generate ");
  const deployIndex = help.indexOf("  deploy ");

  expect(initIndex).toBeGreaterThan(-1);
  expect(generateIndex).toBeGreaterThan(initIndex);
  expect(deployIndex).toBeGreaterThan(generateIndex);
});

test("CLI prints help by default", async () => {
  const result = await runCli([]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: doppler");
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

test("init writes payload-only schema file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-cli-"));
  tempDirs.push(dir);

  const schemaFile = join(dir, "payload.ts");
  const result = await runCli(["init", "--out", schemaFile]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`Created schema: ${schemaFile}`);
  expect(existsSync(schemaFile)).toBe(true);
  expect(existsSync(join(dir, "manifest.json"))).toBe(false);
  expect(existsSync(join(dir, "keys"))).toBe(false);

  const schema = await readFile(schemaFile, "utf8");
  expect(schema).toContain("payload: {");
});

test("init help documents output default and omits keypair options", () => {
  const help = createCommand()
    .commands.find((cmd) => cmd.name() === "init")!
    .helpInformation();

  expect(help).toContain("--out");
  expect(help).toContain('default: "payload.ts"');
  expect(help).not.toContain("--program-id");
  expect(help).not.toContain("--admin");
  expect(help).not.toContain("--keys-dir");
});

test("generate help lists schema file and name arguments", () => {
  const help = createCommand()
    .commands.find((cmd) => cmd.name() === "generate")!
    .helpInformation();

  expect(help).toContain("<schema-file>");
  expect(help).toContain("[name]");
  expect(help).toContain('default: "doppler"');
  expect(help).toContain("--keys-dir");
  expect(help).toContain('"keys"');
  expect(help).not.toContain("--name");
  expect(help).not.toContain("--typescript-sdk");
  expect(help).not.toContain("--rust-sdk");
});

test("generate defaults artifact name to doppler", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-cli-"));
  tempDirs.push(dir);

  const schemaFile = "payload.ts";
  await Bun.write(
    join(dir, schemaFile),
    `export default {
  payload: { price: "u64" },
} as const;
`,
  );
  await Bun.write(
    join(dir, "manifest.json"),
    JSON.stringify({
      name: "doppler",
      programId: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
      admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
    }),
  );

  const result = await runCli(["generate", schemaFile], {
    cwd: dir,
    cli: join(new URL("..", import.meta.url).pathname, "src/cli.ts"),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Generated doppler");
  expect(result.stdout).toContain("Compiled binary: ./doppler.so");
  expect(existsSync(join(dir, "doppler.so"))).toBe(true);
});

test("generate writes keypair files when schema omits program ID and admin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-generator-cli-"));
  tempDirs.push(dir);

  const schemaFile = "payload.ts";
  const keysDir = "keys";
  const schemaContent = `export default {
  payload: {
    price: "u64",
  },
} as const;
`;
  await Bun.write(join(dir, schemaFile), schemaContent);

  const result = await runCli(["generate", schemaFile, "--keys-dir", keysDir], {
    cwd: dir,
    cli: join(new URL("..", import.meta.url).pathname, "src/cli.ts"),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Generated program keypair:");
  expect(result.stdout).toContain("Generated admin keypair:");
  expect(result.stdout).toContain("Compiled binary: ./doppler.so");
  expect(existsSync(join(dir, keysDir, "doppler-program-keypair.json"))).toBe(true);
  expect(existsSync(join(dir, keysDir, "doppler-admin-keypair.json"))).toBe(true);
  expect(existsSync(join(dir, "doppler.so"))).toBe(true);
  expect(existsSync(join(dir, "manifest.json"))).toBe(true);

  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
    name: string;
    programId: string;
    admin: string;
    arch: string;
    payloadSize: number;
  };
  expect(manifest.name).toBe("doppler");
  expect(manifest.programId).toBeTruthy();
  expect(manifest.admin).toBeTruthy();
  expect(manifest.arch).toBe("v3");
  expect(manifest.payloadSize).toBe(8);
  expect(await readFile(join(dir, schemaFile), "utf8")).toBe(schemaContent);
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
  const command = Bun.spawn(["bun", "run", options.cli ?? "src/cli.ts", ...args], {
    cwd: options.cwd ?? generatorDir,
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
