import { fromLegacyTransactionInstruction } from "@solana/compat";
import {
  AccountRole,
  type Instruction as KitInstruction,
  type InstructionWithAccounts,
  type InstructionWithData,
  type ReadonlyUint8Array,
  type AccountMeta,
} from "@solana/kit";
import { Address, TransactionInstruction } from "@solana/web3.js";

/**
 * Kit → legacy bridge matching `@solana/web3-compat`'s `toWeb3Instruction`.
 * Inlined here because web3-compat currently depends on web3.js v1.
 */
export function toWeb3Instruction(kitInstruction: KitInstruction): TransactionInstruction {
  const keys =
    kitInstruction.accounts?.map((account) => ({
      isSigner:
        account.role === AccountRole.READONLY_SIGNER ||
        account.role === AccountRole.WRITABLE_SIGNER,
      isWritable:
        account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER,
      pubkey: new Address(account.address),
    })) ?? [];

  return new TransactionInstruction({
    data: kitInstruction.data ? Uint8Array.from(kitInstruction.data) : new Uint8Array(0),
    keys,
    programId: new Address(kitInstruction.programAddress),
  });
}

/**
 * Legacy → Kit bridge matching `@solana/web3-compat`'s `fromWeb3Instruction`.
 */
export function fromWeb3Instruction(
  legacyInstruction: TransactionInstruction,
): KitInstruction &
  InstructionWithAccounts<readonly AccountMeta[]> &
  InstructionWithData<ReadonlyUint8Array> {
  const kitInstruction = fromLegacyTransactionInstruction(legacyInstruction);
  return {
    programAddress: kitInstruction.programAddress,
    accounts: kitInstruction.accounts ?? [],
    data: kitInstruction.data ?? Uint8Array.from(legacyInstruction.data),
  };
}
