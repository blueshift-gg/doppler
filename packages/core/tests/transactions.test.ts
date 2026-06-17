import { expect, test } from "bun:test";

import { Connection, Keypair } from "@solana/web3.js";

import { createDopplerArtifacts } from "../src/artifacts.js";
import { createGeneratorConfig } from "../src/config.js";
import { LoaderV3Instruction } from "../src/programs/loader-v3.js";
import { buildDeployTransactions } from "../src/transactions.js";

function createMockConnection(): Connection {
  return {
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100,
    }),
    getMinimumBalanceForRentExemption: async (space: number) => BigInt(space * 2),
  } as unknown as Connection;
}

function countPresentSignatures(transaction: {
  signatures: Array<{ signature: Uint8Array | null }>;
}) {
  return transaction.signatures.filter((entry) => entry.signature !== null).length;
}

test("buildDeployTransactions assembles loader v3 deploy transactions", async () => {
  const connection = createMockConnection();
  const payerKeypair = await Keypair.generate();
  const payer = payerKeypair.publicKey;
  const programKeypair = await Keypair.generate();
  const bytecode = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x02, 0x03]);

  const bundle = await buildDeployTransactions({
    connection,
    payer,
    programId: programKeypair.publicKey,
    bytecode,
  });

  expect(bundle.transactions.length).toBeGreaterThanOrEqual(3);
  expect(bundle.programId).toBe(programKeypair.publicKey.toBase58());
  expect(bundle.maxDataLen).toBeGreaterThanOrEqual(bytecode.length);

  const bufferInit = bundle.transactions[0]!;
  const deploy = bundle.transactions.at(-1)!;
  const writes = bundle.transactions.slice(1, -1);

  expect(LoaderV3Instruction.decodeInstructionType(bufferInit.instructions[1]!)).toBe(
    "InitializeBuffer",
  );
  for (const writeTx of writes) {
    expect(LoaderV3Instruction.decodeInstructionType(writeTx.instructions[0]!)).toBe("Write");
  }
  expect(LoaderV3Instruction.decodeInstructionType(deploy.instructions[1]!)).toBe(
    "DeployWithMaxDataLen",
  );

  expect(countPresentSignatures(bufferInit)).toBe(1);
  expect(bufferInit.compileMessage().header.numRequiredSignatures).toBe(2);
  await bufferInit.partialSign(payerKeypair);
  expect(countPresentSignatures(bufferInit)).toBe(2);
});

test("write transactions require two signatures when payer and upgrade authority differ", async () => {
  const payer = (await Keypair.generate()).publicKey;
  const upgradeAuthority = (await Keypair.generate()).publicKey;

  const bundle = await buildDeployTransactions({
    connection: createMockConnection(),
    payer,
    upgradeAuthority,
    programId: (await Keypair.generate()).publicKey,
    bytecode: new Uint8Array(2_000),
  });

  const writeTx = bundle.transactions[1]!;
  expect(writeTx.compileMessage().header.numRequiredSignatures).toBe(2);
});

test("write transactions use a smaller chunk size when two signatures are required", async () => {
  const payer = (await Keypair.generate()).publicKey;
  const upgradeAuthority = (await Keypair.generate()).publicKey;
  const bytecode = new Uint8Array(2_000);

  const sharedAuthorityBundle = await buildDeployTransactions({
    connection: createMockConnection(),
    payer,
    programId: (await Keypair.generate()).publicKey,
    bytecode,
  });

  const distinctAuthorityBundle = await buildDeployTransactions({
    connection: createMockConnection(),
    payer,
    upgradeAuthority,
    programId: (await Keypair.generate()).publicKey,
    bytecode,
  });

  expect(distinctAuthorityBundle.transactions.length).toBeGreaterThan(
    sharedAuthorityBundle.transactions.length,
  );
});

test("buildDeployTransactions compiles bytecode from generator config", async () => {
  const programKeypair = await Keypair.generate();
  const adminKeypair = await Keypair.generate();
  const config = createGeneratorConfig(
    {
      name: "price-feed",
      programId: programKeypair.publicKey.toBase58(),
      admin: adminKeypair.publicKey.toBase58(),
      payload: { price: "u64" },
    },
    {},
  );

  const { bytecode } = await createDopplerArtifacts(config);
  expect(bytecode.byteLength).toBeGreaterThan(0);

  const bundle = await buildDeployTransactions({
    connection: createMockConnection(),
    payer: (await Keypair.generate()).publicKey,
    programId: (await Keypair.generate()).publicKey,
    bytecode,
  });

  expect(bundle.transactions.length).toBeGreaterThanOrEqual(3);
  expect(bundle.maxDataLen).toBeGreaterThanOrEqual(bytecode.length);
});
