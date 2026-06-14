import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Keypair } from "@solana/web3.js";

import { deployDopplerProgram } from "../src/deploy.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("deploy rejects admin mismatch against manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-deploy-"));
  tempDirs.push(dir);

  const bytecodePath = join(dir, "price-feed.so");
  const programKeypairPath = join(dir, "program-keypair.json");
  const signerKeypairPath = join(dir, "signer-keypair.json");
  const configPath = join(dir, "config.yml");

  const programKeypair = await Keypair.generate();
  const signerKeypair = await Keypair.generate();

  await writeFile(bytecodePath, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  await writeFile(programKeypairPath, `${JSON.stringify(Array.from(programKeypair.secretKey))}\n`);
  await writeFile(signerKeypairPath, `${JSON.stringify(Array.from(signerKeypair.secretKey))}\n`);
  await writeFile(
    configPath,
    `json_rpc_url: https://api.devnet.solana.com
keypair_path: ${signerKeypairPath}
`,
  );
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify({
      programId: programKeypair.publicKey.toBase58(),
      admin: "admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE",
    })}\n`,
  );

  await expect(
    deployDopplerProgram({
      bytecodePath,
      programKeypairPath,
      admin: "11111111111111111111111111111111",
      configPath,
    }),
  ).rejects.toThrow("does not match manifest admin");
});

// TODO: add test for actual deployment against localnet
