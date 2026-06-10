#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { Keypair } from "@solana/web3.js";
import { createGeneratorConfig, loadGeneratorConfigInput } from "./config.js";
import { generateDopplerArtifacts } from "./emit.js";
import type { ConfigOverrides, SbpfArch } from "./config.js";

type GenerateArgs = {
  schemaFile: string;
  bytecodeFile?: string;
  web3jsSdkDir?: string;
  kitSdkDir?: string;
  rustSdkDir?: string;
  manifestFile?: string;
  assemblyFile?: string;
  keysDir: string;
  overrides: ConfigOverrides;
};

type InitOptions = {
  out?: string;
  keysDir: string;
  programId?: string;
  admin?: string;
};

type GeneratedKeypair = {
  role: "program" | "admin";
  publicKey: string;
  file: string;
};

async function main(): Promise<void> {
  const program = createCommand();
  await program.parseAsync(process.argv);
}

export function createCommand(): Command {
  const program = new Command()
    .name("doppler-generator")
    .description("Generate custom Doppler bytecode and SDK files from a payload schema")
    .showHelpAfterError()
    .addHelpText(
      "after",
      `
Examples:
  $ doppler-generator init price-feed
  $ doppler-generator generate ./price-feed.payload.ts --web3js-sdk ./generated/price-feed/web3js
`,
    );

  program
    .command("generate")
    .description("Generate compiled Doppler bytecode and optional SDK files")
    .argument("<schema-file>", "Path to TypeScript, JavaScript, or JSON payload schema/config")
    .option("--bytecode <file>", "Output filepath for compiled Doppler bytecode. Defaults to ./<name>.so")
    .option("--web3js-sdk <directory>", "Output directory for generated @solana/web3.js SDK")
    .option("--kit-sdk <directory>", "Output directory for generated @solana/kit SDK")
    .option("--rust-sdk <directory>", "Output directory for generated Rust SDK")
    .option("--manifest <file>", "Output filepath for manifest JSON")
    .option("--assembly <file>", "Output filepath for generated assembly source")
    .option("--arch <arch>", "Target sBPF arch. Defaults to v3", parseArch)
    .option("--program-id <address>", "Program ID override")
    .option("--admin <address>", "Admin address override")
    .option("--name <name>", "Generated artifact name override")
    .option("--keys-dir <directory>", "Directory for generated keypair files", "keys")
    .action(async (schemaFile: string, options: GenerateCommandOptions) => {
      await runGenerate(toGenerateArgs(schemaFile, options));
    });

  program
    .command("init")
    .description("Create a starter payload schema and local keypair files")
    .argument("[name]", "Payload config name", "price-feed")
    .option("--out <file>", "Schema output filepath")
    .option("--keys-dir <directory>", "Directory for generated keypair files", "keys")
    .option("--program-id <address>", "Program ID to write into the schema")
    .option("--admin <address>", "Admin address to write into the schema")
    .action(async (name: string, options: InitOptions) => {
      await runInit(name, options);
    });

  program.action(() => {
    program.help();
  });

  return program;
}

async function runGenerate(args: GenerateArgs): Promise<void> {
  const loaded = await loadGeneratorConfigInput(args.schemaFile);

  const slug = slugify(args.overrides.name ?? loaded.name ?? "doppler");
  const bytecodeFile = args.bytecodeFile ?? `./${slug}.so`;
  const generatedKeypairs: GeneratedKeypair[] = [];
  const overrides: ConfigOverrides = {
    ...args.overrides,
    programId:
      args.overrides.programId ??
      loaded.programId ??
      (await generateKeypair("program", slug, args.keysDir, generatedKeypairs)),
    admin:
      args.overrides.admin ??
      loaded.admin ??
      (await generateKeypair("admin", slug, args.keysDir, generatedKeypairs)),
  };

  const config = createGeneratorConfig(loaded, overrides);
  const manifest = await generateDopplerArtifacts(config, {
    bytecodeFile,
    ...(args.web3jsSdkDir ? { web3jsSdkDir: args.web3jsSdkDir } : {}),
    ...(args.kitSdkDir ? { kitSdkDir: args.kitSdkDir } : {}),
    ...(args.rustSdkDir ? { rustSdkDir: args.rustSdkDir } : {}),
    ...(args.manifestFile ? { manifestFile: args.manifestFile } : {}),
    ...(args.assemblyFile ? { assemblyFile: args.assemblyFile } : {}),
  });

  console.log(
    `Generated ${manifest.name} (${manifest.arch}, ${manifest.payloadSize} byte payload)`,
  );
  console.log(`Compiled bytecode: ${bytecodeFile}`);
  printGeneratedOutputs(args);
  printGeneratedKeypairs(generatedKeypairs);
}

function printGeneratedOutputs(args: GenerateArgs): void {
  if (args.assemblyFile) {
    console.log(`Assembly source: ${args.assemblyFile}`);
  }

  if (args.manifestFile) {
    console.log(`Manifest: ${args.manifestFile}`);
  }

  if (args.web3jsSdkDir) {
    console.log(`Web3.js SDK: ${args.web3jsSdkDir}`);
  }

  if (args.kitSdkDir) {
    console.log(`Kit SDK: ${args.kitSdkDir}`);
  }

  if (args.rustSdkDir) {
    console.log(`Rust SDK: ${args.rustSdkDir}`);
  }
}

async function runInit(name: string, options: InitOptions): Promise<void> {
  const slug = slugify(name);
  const schemaFile = resolve(options.out ?? `${slug}.payload.ts`);
  const generatedKeypairs: GeneratedKeypair[] = [];

  const programId = options.programId ?? (await generateKeypair("program", slug, options.keysDir, generatedKeypairs));
  const admin = options.admin ?? (await generateKeypair("admin", slug, options.keysDir, generatedKeypairs));

  await writeFileEnsuringDir(schemaFile, renderStarterSchema(name, programId, admin));

  console.log(`Created schema: ${schemaFile}`);
  printGeneratedKeypairs(generatedKeypairs);
}

function printGeneratedKeypairs(generatedKeypairs: GeneratedKeypair[]): void {
  for (const keypair of generatedKeypairs) {
    console.log(
      `Generated ${keypair.role} keypair: ${keypair.file} (${keypair.publicKey})`,
    );
  }
  if (generatedKeypairs.length > 0) {
    console.log("Keep generated keypair files secure; the admin key controls oracle updates.");
  }
}

async function generateKeypair(
  role: "program" | "admin",
  slug: string,
  keysDir: string,
  generatedKeypairs: GeneratedKeypair[],
): Promise<string> {
  const keypair = await Keypair.generate();
  const file = resolve(keysDir, `${slug}-${role}-keypair.json`);
  await writeFileEnsuringDir(file, `${JSON.stringify(Array.from(keypair.secretKey))}\n`);

  const publicKey = keypair.publicKey.toBase58();
  generatedKeypairs.push({ role, publicKey, file });
  return publicKey;
}

function renderStarterSchema(name: string, programId: string, admin: string): string {
  return `export default {
  name: ${JSON.stringify(name)},
  programId: ${JSON.stringify(programId)},
  admin: ${JSON.stringify(admin)},
  payload: {
    price: "u64",
  },
} as const;
`;
}

async function writeFileEnsuringDir(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

type GenerateCommandOptions = {
  bytecode?: string;
  web3jsSdk?: string;
  kitSdk?: string;
  rustSdk?: string;
  manifest?: string;
  assembly?: string;
  arch?: SbpfArch;
  programId?: string;
  admin?: string;
  name?: string;
  keysDir: string;
};

function toGenerateArgs(schemaFile: string, options: GenerateCommandOptions): GenerateArgs {
  const overrides: ConfigOverrides = {
    ...(options.arch ? { arch: options.arch } : {}),
    ...(options.programId ? { programId: options.programId } : {}),
    ...(options.admin ? { admin: options.admin } : {}),
    ...(options.name ? { name: options.name } : {}),
  };

  return {
    schemaFile,
    ...(options.bytecode ? { bytecodeFile: options.bytecode } : {}),
    ...(options.web3jsSdk ? { web3jsSdkDir: options.web3jsSdk } : {}),
    ...(options.kitSdk ? { kitSdkDir: options.kitSdk } : {}),
    ...(options.rustSdk ? { rustSdkDir: options.rustSdk } : {}),
    ...(options.manifest ? { manifestFile: options.manifest } : {}),
    ...(options.assembly ? { assemblyFile: options.assembly } : {}),
    keysDir: options.keysDir,
    overrides,
  };
}

function parseArch(value: string): SbpfArch {
  if (value !== "v0" && value !== "v3") {
    throw new InvalidArgumentError("expected 'v0' or 'v3'");
  }
  return value;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "doppler";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
