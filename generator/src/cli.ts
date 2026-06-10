#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { loadGeneratorConfig } from "./config.js";
import { generateDopplerArtifacts } from "./emit.js";
import type { ConfigOverrides, SbpfArch } from "./config.js";

type CliArgs = {
  schemaFile: string;
  bytecodeFile: string;
  tsSdkDir?: string;
  rustSdkDir?: string;
  manifestFile?: string;
  assemblyFile?: string;
  overrides: ConfigOverrides;
};

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);
  const config = await loadGeneratorConfig(args.schemaFile, args.overrides);
  const manifest = await generateDopplerArtifacts(config, {
    bytecodeFile: args.bytecodeFile,
    ...(args.tsSdkDir ? { tsSdkDir: args.tsSdkDir } : {}),
    ...(args.rustSdkDir ? { rustSdkDir: args.rustSdkDir } : {}),
    ...(args.manifestFile ? { manifestFile: args.manifestFile } : {}),
    ...(args.assemblyFile ? { assemblyFile: args.assemblyFile } : {}),
  });

  console.log(
    `Generated ${manifest.name} (${manifest.arch}, ${manifest.payloadSize} byte payload)`,
  );
  console.log(`Bytecode: ${args.bytecodeFile}`);
}

export function parseCliArgs(argv: string[]): CliArgs {
  const program = createCommand();
  program.exitOverride();
  program.configureOutput({
    writeErr: (message) => {
      throw new Error(message.trim());
    },
  });

  program.parse(argv, { from: "node" });
  const options = program.opts<{
    bytecode: string;
    tsSdk?: string;
    rustSdk?: string;
    manifest?: string;
    assembly?: string;
    arch?: SbpfArch;
    programId?: string;
    admin?: string;
    name?: string;
  }>();
  const [schemaFile] = program.args;

  if (!schemaFile) {
    throw new Error("Missing required argument '<schema-file>'");
  }

  const overrides: ConfigOverrides = {
    ...(options.arch ? { arch: options.arch } : {}),
    ...(options.programId ? { programId: options.programId } : {}),
    ...(options.admin ? { admin: options.admin } : {}),
    ...(options.name ? { name: options.name } : {}),
  };

  return {
    schemaFile,
    bytecodeFile: options.bytecode,
    ...(options.tsSdk ? { tsSdkDir: options.tsSdk } : {}),
    ...(options.rustSdk ? { rustSdkDir: options.rustSdk } : {}),
    ...(options.manifest ? { manifestFile: options.manifest } : {}),
    ...(options.assembly ? { assemblyFile: options.assembly } : {}),
    overrides,
  };
}

function createCommand(): Command {
  return new Command()
    .name("doppler-generator")
    .description("Generate custom Doppler bytecode and SDK files from a payload schema")
    .argument("<schema-file>", "Path to TypeScript, JavaScript, or JSON payload schema/config")
    .requiredOption("--bytecode <file>", "Output filepath for compiled Doppler bytecode")
    .option("--ts-sdk <directory>", "Output directory for generated TypeScript SDK")
    .option("--rust-sdk <directory>", "Output directory for generated Rust SDK")
    .option("--manifest <file>", "Output filepath for manifest JSON")
    .option("--assembly <file>", "Output filepath for generated assembly source")
    .option("--arch <arch>", "Target sBPF arch. Defaults to v3", parseArch)
    .option("--program-id <address>", "Program ID override")
    .option("--admin <address>", "Admin address override")
    .option("--name <name>", "Generated artifact name override");
}

function parseArch(value: string): SbpfArch {
  if (value !== "v0" && value !== "v3") {
    throw new InvalidArgumentError("expected 'v0' or 'v3'");
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
