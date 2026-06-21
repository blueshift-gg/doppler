import {
  deserializeOracle,
  oracleAccountSize,
  oracleUpdateComputeBudget,
  serializeOracle,
} from "@blueshift-gg/doppler-common";
import type { Oracle, FixedSizeCodec } from "@blueshift-gg/doppler-common";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
  getSetLoadedAccountsDataSizeLimitInstruction,
} from "@solana-program/compute-budget";
import { getCreateAccountWithSeedInstruction } from "@solana-program/system";
import {
  AccountRole,
  createAddressWithSeed,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type Address,
  type Commitment,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";

import { decodeBase64AccountData } from "./decode-base64";
import type { DopplerConfig } from "./types";

type SolanaRpc = ReturnType<typeof createSolanaRpc>;
type SolanaRpcSubscriptions = ReturnType<typeof createSolanaRpcSubscriptions>;

type AccountNotification = Readonly<{
  value: Readonly<{
    data: readonly [string, string];
  }> | null;
}>;

export type SubscribeToOracleOptions = Readonly<{
  commitment?: Commitment;
}>;

export type OracleSubscription<T> = Readonly<{
  notifications: AsyncIterable<Oracle<T>>;
  unsubscribe: () => void;
}>;

/** Client for creating, updating, and reading Doppler oracle accounts. */
export class Doppler<T> {
  private readonly programId: Address;
  private readonly admin: Address;
  private readonly payloadCodec: FixedSizeCodec<T>;

  constructor(
    private readonly rpc: SolanaRpc,
    private readonly rpcSubscriptions: SolanaRpcSubscriptions,
    config: DopplerConfig<T>,
  ) {
    this.programId = config.programId;
    this.admin = config.admin;
    this.payloadCodec = config.payloadCodec;
  }

  /** Fetch and deserialize an oracle account. */
  async fetchOracle(oraclePubkey: Address): Promise<Oracle<T> | null> {
    const { value: accountInfo } = await this.rpc
      .getAccountInfo(oraclePubkey, { encoding: "base64" })
      .send();

    if (!accountInfo) {
      return null;
    }

    const [encodedData] = accountInfo.data;
    return deserializeOracle(decodeBase64AccountData(encodedData), this.payloadCodec);
  }

  /** Deserialize oracle account data from raw bytes. */
  deserializeOracle(data: Uint8Array): Oracle<T> {
    return deserializeOracle(data, this.payloadCodec);
  }

  /** Subscribe to live oracle account updates over WebSocket. */
  async subscribeToOracle(
    oraclePubkey: Address,
    options: SubscribeToOracleOptions = {},
  ): Promise<OracleSubscription<T>> {
    const abortController = new AbortController();
    const { commitment = "confirmed" } = options;

    const accountNotifications = await this.rpcSubscriptions
      .accountNotifications(oraclePubkey, {
        encoding: "base64",
        commitment,
      })
      .subscribe({ abortSignal: abortController.signal });

    return {
      notifications: mapOracleNotifications(accountNotifications, this.payloadCodec),
      unsubscribe: () => {
        abortController.abort();
      },
    };
  }

  /** Build an instruction that initializes a oracle account derived from a seed. */
  async createOracleAccount(
    seed: string,
    payer: TransactionSigner,
  ): Promise<{ oraclePubkey: Address; instruction: Instruction }> {
    const space = oracleAccountSize(this.payloadCodec);
    const lamports = await this.rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();

    const oraclePubkey = await createAddressWithSeed({
      baseAddress: payer.address,
      seed,
      programAddress: this.programId,
    });

    const instruction = getCreateAccountWithSeedInstruction({
      payer,
      newAccount: oraclePubkey,
      baseAccount: payer,
      base: payer.address,
      seed,
      amount: lamports,
      space,
      programAddress: this.programId,
    });

    return { oraclePubkey, instruction };
  }

  /**
   * Build compute budget and oracle update instructions.
   *
   * Returns instructions in this order:
   * 1. `SetComputeUnitPrice` when `unitPrice` is provided
   * 2. `SetLoadedAccountsDataSizeLimit`
   * 3. `SetComputeUnitLimit`
   * 4. One Doppler oracle update instruction per entry in `updates`
   */
  createUpdateInstructions(
    updates: Array<{
      oraclePubkey: Address;
      oracle: Oracle<T>;
    }>,
    unitPrice?: bigint,
  ): Instruction[] {
    const budget =
      unitPrice === undefined
        ? oracleUpdateComputeBudget(this.payloadCodec, updates.length)
        : oracleUpdateComputeBudget(this.payloadCodec, updates.length, { unitPrice });

    const instructions: Instruction[] = [];

    if (unitPrice !== undefined) {
      instructions.push(
        getSetComputeUnitPriceInstruction({
          microLamports: unitPrice,
        }),
      );
    }

    instructions.push(
      getSetLoadedAccountsDataSizeLimitInstruction({
        accountDataSizeLimit: budget.loadedAccountDataSize,
      }),
      getSetComputeUnitLimitInstruction({
        units: budget.computeUnits,
      }),
    );

    for (const update of updates) {
      instructions.push({
        programAddress: this.programId,
        accounts: [
          { address: this.admin, role: AccountRole.READONLY_SIGNER },
          { address: update.oraclePubkey, role: AccountRole.WRITABLE },
        ],
        data: serializeOracle(update.oracle, this.payloadCodec),
      });
    }

    return instructions;
  }

  getRpc(): SolanaRpc {
    return this.rpc;
  }

  getProgramId(): Address {
    return this.programId;
  }

  getAdmin(): Address {
    return this.admin;
  }
}

async function* mapOracleNotifications<T>(
  notifications: AsyncIterable<AccountNotification>,
  payloadCodec: FixedSizeCodec<T>,
): AsyncGenerator<Oracle<T>> {
  for await (const notification of notifications) {
    const accountInfo = notification.value;
    if (!accountInfo) {
      continue;
    }

    const [encodedData] = accountInfo.data;
    yield deserializeOracle(decodeBase64AccountData(encodedData), payloadCodec);
  }
}
