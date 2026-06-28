# Generator Update Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `doppler-generator update` command that sends a serialized Doppler oracle update transaction.

**Architecture:** Keep transaction construction in a new `generator/src/update.ts` module and keep Commander wiring in `generator/src/cli.ts`. The command accepts the requested program ID, serialized payload JSON, and admin keypair path, and also requires an oracle account address because the on-chain update instruction needs a writable oracle account.

**Tech Stack:** Bun, TypeScript, Commander, `@solana/web3.js` v3, existing Solana CLI config helpers.

---

## Scope Notes

The requested args are `program ID`, `payload`, and `admin keypair path`. Doppler updates cannot be sent with only those values: the instruction also needs the oracle account to update. Implement the CLI as:

```sh
doppler-generator update <program-id> <payload-json> \
  --oracle <oracle-address> \
  --admin-keypair <file>
```

`--admin-keypair` defaults to `keypair_path` from Solana CLI config. The payload JSON is treated as already-serialized instruction data, encoded as a JSON array of byte values:

```json
[1, 0, 0, 0, 0, 0, 0, 0, 42, 0, 0, 0, 0, 0, 0, 0]
```

This keeps the command schema-agnostic. Typed JSON payloads such as `{ "sequence": 1, "payload": { "price": 42 } }` require a schema/serializer and are intentionally out of scope for this feature.

## File Structure

- Modify `generator/src/cli.ts`: add `update` command, option type, and `runUpdate` wrapper.
- Create `generator/src/update.ts`: parse serialized payload JSON, load admin keypair, build/send/confirm update transaction, return signature/network metadata.
- Modify `generator/tests/cli.test.ts`: cover help ordering and CLI validation/default option behavior.
- Create `generator/tests/update.test.ts`: unit-test payload parsing, keypair loading validation, instruction shape, and Solana CLI config fallback behavior.
- Modify `generator/README.md`: document update usage, arguments, defaults, and payload format.

## Task 1: Add Update Core Module

**Files:**

- Create: `generator/src/update.ts`
- Test: `generator/tests/update.test.ts`

- [ ] **Step 1: Write failing tests for serialized payload parsing**

Add this to `generator/tests/update.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "bun:test";
import { Keypair, Address } from "@solana/web3.js";
import {
  buildDopplerUpdateInstruction,
  loadKeypairFromFile,
  parseSerializedPayloadJson,
  resolveUpdateConfig,
} from "../src/update.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("parseSerializedPayloadJson accepts a JSON byte array", () => {
  expect(Array.from(parseSerializedPayloadJson("[1, 2, 255]"))).toEqual([1, 2, 255]);
});

test("parseSerializedPayloadJson rejects non-array JSON", () => {
  expect(() => parseSerializedPayloadJson('{"sequence":1}')).toThrow(
    "Serialized payload must be a JSON array of bytes",
  );
});

test("parseSerializedPayloadJson rejects out-of-range bytes", () => {
  expect(() => parseSerializedPayloadJson("[0, 256]")).toThrow(
    "Serialized payload byte at index 1 must be an integer from 0 to 255",
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```sh
cd generator
bun test tests/update.test.ts
```

Expected: FAIL because `generator/src/update.ts` does not exist.

- [ ] **Step 3: Implement payload parsing and keypair loading**

Create `generator/src/update.ts`:

```ts
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Address, Connection, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import { DEFAULT_SOLANA_CONFIG_PATH, loadSolanaCliConfig } from "./solana-config.js";

export type UpdateOptions = {
  programId: string;
  oracle: string;
  payloadJson: string;
  adminKeypairPath?: string;
  network?: string;
  configPath?: string;
};

export type UpdateResult = {
  signature: string;
  programId: string;
  oracle: string;
  admin: string;
  network: string;
};

export type ResolvedUpdateConfig = {
  programId: Address;
  oracle: Address;
  payload: Uint8Array;
  adminKeypairPath: string;
  network: string;
};

export function parseSerializedPayloadJson(payloadJson: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    throw new Error(
      `Serialized payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Serialized payload must be a JSON array of bytes");
  }

  return Uint8Array.from(
    parsed.map((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(
          `Serialized payload byte at index ${index} must be an integer from 0 to 255`,
        );
      }
      return value;
    }),
  );
}

export async function loadKeypairFromFile(path: string): Promise<Keypair> {
  const secret = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    !Array.isArray(secret) ||
    secret.length !== 64 ||
    secret.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    throw new Error(`Invalid keypair file: ${path}`);
  }

  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function assertFileExists(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```sh
cd generator
bun test tests/update.test.ts
```

Expected: PASS for the three parsing tests.

- [ ] **Step 5: Add tests for instruction construction and config fallback**

Append to `generator/tests/update.test.ts`:

```ts
test("buildDopplerUpdateInstruction creates expected account metas and data", () => {
  const admin = new Address("admnz5UvRa93HM5nTrxXmsJ1rw2tvXMBFGauvCgzQhE");
  const oracle = new Address("fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm");
  const programId = new Address("11111111111111111111111111111111");
  const instruction = buildDopplerUpdateInstruction({
    programId,
    oracle,
    admin,
    payload: Uint8Array.from([1, 2, 3]),
  });

  expect(instruction.programId.toBase58()).toBe(programId.toBase58());
  expect(instruction.keys).toEqual([
    { pubkey: admin, isSigner: true, isWritable: false },
    { pubkey: oracle, isSigner: false, isWritable: true },
  ]);
  expect(Array.from(instruction.data)).toEqual([1, 2, 3]);
});

test("resolveUpdateConfig defaults admin keypair and network from Solana CLI config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-update-"));
  tempDirs.push(dir);

  const admin = await Keypair.generate();
  const adminKeypairPath = join(dir, "admin.json");
  const configPath = join(dir, "config.yml");

  await writeFile(adminKeypairPath, `${JSON.stringify(Array.from(admin.secretKey))}\n`);
  await writeFile(
    configPath,
    `json_rpc_url: https://rpc.example.com
keypair_path: ${adminKeypairPath}
`,
  );

  const resolved = await resolveUpdateConfig({
    programId: "11111111111111111111111111111111",
    oracle: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
    payloadJson: "[1,2,3]",
    configPath,
  });

  expect(resolved.adminKeypairPath).toBe(adminKeypairPath);
  expect(resolved.network).toBe("https://rpc.example.com");
  expect(Array.from(resolved.payload)).toEqual([1, 2, 3]);
});
```

- [ ] **Step 6: Implement instruction construction and config fallback**

Append to `generator/src/update.ts`:

```ts
export function buildDopplerUpdateInstruction(input: {
  programId: Address;
  oracle: Address;
  admin: Address;
  payload: Uint8Array;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    keys: [
      {
        pubkey: input.admin,
        isSigner: true,
        isWritable: false,
      },
      {
        pubkey: input.oracle,
        isSigner: false,
        isWritable: true,
      },
    ],
    data: input.payload,
  });
}

export async function resolveUpdateConfig(options: UpdateOptions): Promise<ResolvedUpdateConfig> {
  const configPath = resolve(options.configPath ?? DEFAULT_SOLANA_CONFIG_PATH);
  const config = await loadSolanaCliConfig(configPath);
  const adminKeypairPath = resolve(options.adminKeypairPath ?? config.keypairPath);

  await assertFileExists(adminKeypairPath, "Admin keypair file");

  return {
    programId: new Address(options.programId),
    oracle: new Address(options.oracle),
    payload: parseSerializedPayloadJson(options.payloadJson),
    adminKeypairPath,
    network: options.network ?? config.jsonRpcUrl,
  };
}
```

- [ ] **Step 7: Add tests for send-and-confirm behavior with a fake connection**

Append to `generator/tests/update.test.ts`:

```ts
test("updateDopplerOracle sends and confirms the signed transaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "doppler-update-"));
  tempDirs.push(dir);

  const admin = await Keypair.generate();
  const adminKeypairPath = join(dir, "admin.json");
  const configPath = join(dir, "config.yml");
  const sentTransactions: Uint8Array[] = [];

  await writeFile(adminKeypairPath, `${JSON.stringify(Array.from(admin.secretKey))}\n`);
  await writeFile(
    configPath,
    `json_rpc_url: https://rpc.example.com
keypair_path: ${adminKeypairPath}
`,
  );

  const connection = {
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 123n,
    }),
    sendRawTransaction: async (bytes: Uint8Array) => {
      sentTransactions.push(bytes);
      return "5".repeat(64);
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  };

  const result = await updateDopplerOracle(
    {
      programId: "11111111111111111111111111111111",
      oracle: "fastRQJt3nLdY3QA7n8eZ8ETEVefy56ryfUGVkfZokm",
      payloadJson: "[1,2,3]",
      configPath,
    },
    connection as never,
  );

  expect(result.signature).toBe("5".repeat(64));
  expect(result.admin).toBe(admin.publicKey.toBase58());
  expect(result.network).toBe("https://rpc.example.com");
  expect(sentTransactions).toHaveLength(1);
});
```

- [ ] **Step 8: Implement transaction sending**

Append to `generator/src/update.ts`:

```ts
type UpdateConnection = Pick<
  Connection,
  "getLatestBlockhash" | "sendRawTransaction" | "confirmTransaction"
>;

export async function updateDopplerOracle(
  options: UpdateOptions,
  connectionOverride?: UpdateConnection,
): Promise<UpdateResult> {
  const resolved = await resolveUpdateConfig(options);
  const adminKeypair = await loadKeypairFromFile(resolved.adminKeypairPath);
  const connection = connectionOverride ?? new Connection(resolved.network);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const transaction = new Transaction({
    feePayer: adminKeypair.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    buildDopplerUpdateInstruction({
      programId: resolved.programId,
      oracle: resolved.oracle,
      admin: adminKeypair.publicKey,
      payload: resolved.payload,
    }),
  );

  await transaction.sign(adminKeypair);
  const signature = await connection.sendRawTransaction(await transaction.serialize(), {
    skipPreflight: false,
  });

  const { value } = await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  if (value.err) {
    throw new Error(`Transaction ${signature} failed: ${JSON.stringify(value.err)}`);
  }

  return {
    signature,
    programId: resolved.programId.toBase58(),
    oracle: resolved.oracle.toBase58(),
    admin: adminKeypair.publicKey.toBase58(),
    network: resolved.network,
  };
}
```

- [ ] **Step 9: Run update tests**

Run:

```sh
cd generator
bun test tests/update.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```sh
git add generator/src/update.ts generator/tests/update.test.ts
git commit -m "feat(generator): add oracle update transaction core"
```

## Task 2: Wire the CLI Command

**Files:**

- Modify: `generator/src/cli.ts`
- Modify: `generator/tests/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Modify the workflow-order test in `generator/tests/cli.test.ts`:

```ts
test("createCommand help lists commands in workflow order", () => {
  const help = createCommand().helpInformation();
  const initIndex = help.indexOf("init");
  const generateIndex = help.indexOf("generate");
  const deployIndex = help.indexOf("deploy");
  const updateIndex = help.indexOf("update");

  expect(initIndex).toBeGreaterThan(-1);
  expect(generateIndex).toBeGreaterThan(initIndex);
  expect(deployIndex).toBeGreaterThan(generateIndex);
  expect(updateIndex).toBeGreaterThan(deployIndex);
});
```

Add this test:

```ts
test("update requires oracle flag", async () => {
  const result = await runCli(["update", "11111111111111111111111111111111", "[1,2,3]"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("--oracle");
});
```

Update the default help test:

```ts
expect(result.stdout).toContain("update");
```

- [ ] **Step 2: Run CLI tests and verify they fail**

Run:

```sh
cd generator
bun test tests/cli.test.ts
```

Expected: FAIL because `update` is not registered.

- [ ] **Step 3: Wire the command in `generator/src/cli.ts`**

Add the import:

```ts
import { updateDopplerOracle } from "./update.js";
```

Add this type near `DeployOptions`:

```ts
type UpdateCommandOptions = {
  oracle: string;
  adminKeypair?: string;
  network?: string;
  config?: string;
};
```

Add the command after `deploy`:

```ts
program
  .command("update")
  .description("Send a serialized Doppler oracle update transaction")
  .argument("<program-id>", "Doppler program ID")
  .argument("<payload-json>", "Serialized oracle instruction data as a JSON byte array")
  .requiredOption("--oracle <address>", "Oracle account address to update")
  .option(
    "--admin-keypair <file>",
    "Admin keypair for signing updates. Defaults to keypair_path in Solana CLI config",
  )
  .option("--network <url>", "RPC URL for update. Defaults to json_rpc_url in Solana CLI config")
  .option("--config <file>", `Solana CLI config file. Defaults to ${DEFAULT_SOLANA_CONFIG_PATH}`)
  .action(async (programId: string, payloadJson: string, options: UpdateCommandOptions) => {
    await runUpdate(programId, payloadJson, options);
  });
```

Add this function after `runDeploy`:

```ts
async function runUpdate(
  programId: string,
  payloadJson: string,
  options: UpdateCommandOptions,
): Promise<void> {
  const result = await updateDopplerOracle({
    programId,
    payloadJson,
    oracle: options.oracle,
    ...(options.adminKeypair ? { adminKeypairPath: options.adminKeypair } : {}),
    ...(options.network ? { network: options.network } : {}),
    ...(options.config ? { configPath: options.config } : {}),
  });

  console.log(`Updated oracle ${result.oracle}`);
  console.log(`Program: ${result.programId}`);
  console.log(`Admin: ${result.admin}`);
  console.log(`Network: ${result.network}`);
  console.log(`Signature: ${result.signature}`);
}
```

- [ ] **Step 4: Run CLI tests**

Run:

```sh
cd generator
bun test tests/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```sh
git add generator/src/cli.ts generator/tests/cli.test.ts
git commit -m "feat(generator): add update CLI command"
```

## Task 3: Document the Update Command

**Files:**

- Modify: `generator/README.md`

- [ ] **Step 1: Add update docs after Deploy section**

Insert this section in `generator/README.md` after the Deploy section:

````md
## Update

Send a serialized oracle update transaction:

```sh
npx @blueshift-gg/doppler-generator update <program-id> '[1,0,0,0,0,0,0,0,42,0,0,0,0,0,0,0]' \
  --oracle <oracle-address>
```

Useful flags:

```txt
--oracle <address>          Required. Oracle account address to update.
--admin-keypair <file>      Admin keypair for signing updates. Defaults to keypair_path in Solana CLI config.
--network <url>             RPC URL for update. Defaults to json_rpc_url in Solana CLI config.
--config <file>             Solana CLI config file. Defaults to ~/.config/solana/cli/config.yml.
```

The payload argument must be serialized instruction data encoded as a JSON array of bytes. The generator CLI does not infer payload schema from typed JSON during updates. Use the generated SDK serializer when constructing this byte array from a typed payload.
````

- [ ] **Step 2: Commit**

Run:

```sh
git add generator/README.md
git commit -m "docs(generator): document update command"
```

## Task 4: Final Verification

**Files:**

- Verify: `generator/src/update.ts`
- Verify: `generator/src/cli.ts`
- Verify: `generator/tests/update.test.ts`
- Verify: `generator/tests/cli.test.ts`
- Verify: `generator/README.md`

- [ ] **Step 1: Run generator tests**

Run:

```sh
cd generator
bun test
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript checks**

Run:

```sh
cd generator
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run package build**

Run:

```sh
cd generator
bun run build
```

Expected: PASS and `dist/cli.js` includes the `update` command.

- [ ] **Step 4: Verify CLI help manually**

Run:

```sh
cd generator
bun run src/cli.ts update --help
```

Expected output includes:

```txt
Usage: doppler-generator update [options] <program-id> <payload-json>
--oracle <address>
--admin-keypair <file>
--network <url>
--config <file>
```

- [ ] **Step 5: Commit verification fixes if any were needed**

If verification required code changes, run:

```sh
git add generator/src/update.ts generator/src/cli.ts generator/tests/update.test.ts generator/tests/cli.test.ts generator/README.md
git commit -m "fix(generator): stabilize update command"
```

If no verification fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan adds an `update` command with program ID, serialized JSON payload, admin keypair path defaulting to Solana CLI config, Solana CLI config/network defaults, and send/confirm behavior. The plan adds required `--oracle` because the update instruction cannot be constructed without it.
- Placeholder scan: No task uses deferred-work markers, "similar to", or unspecified error handling.
- Type consistency: `UpdateOptions`, `ResolvedUpdateConfig`, `UpdateResult`, `UpdateCommandOptions`, and function names are consistent across tests, implementation, and CLI wiring.
