// @ts-nocheck - build-time script outside cli/tests/tsconfig.json
import { join } from "node:path";

import { loadGeneratorConfig } from "../../../src/config.js";
import { writeDopplerArtifacts } from "../../../src/emit.js";

const [outDir, schemaFile] = process.argv.slice(2);

if (!outDir || !schemaFile) {
  console.error("Usage: generate-artifacts.mts <out-dir> <schema-file>");
  process.exit(1);
}

const config = await loadGeneratorConfig(schemaFile);
await writeDopplerArtifacts(config, {
  binaryFile: join(outDir, "doppler.so"),
});
