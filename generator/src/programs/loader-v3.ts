// NOTE: Temporary until loader v3 helpers are merged upstream into web3.js

import { createNoopSigner, type ReadonlyUint8Array } from "@solana/kit";
import {
  getCloseInstruction,
  getDeployWithMaxDataLenInstruction,
  getExtendProgramInstruction,
  getInitializeBufferInstruction,
  getSetAuthorityCheckedInstruction,
  getSetAuthorityInstruction,
  getUpgradeInstruction,
  getWriteInstruction,
  identifyLoaderV3Instruction,
  LOADER_V3_PROGRAM_ADDRESS,
  LoaderV3Instruction as GeneratedLoaderV3Instruction,
  parseLoaderV3Instruction,
  type ParsedLoaderV3Instruction,
} from "@solana-program/loader-v3";
import { Address, TransactionInstruction } from "@solana/web3.js";
import { fromWeb3Instruction, toWeb3Instruction } from "../kit-adapters/instruction.js";

const LOADER_V3_PROGRAM_ID = new Address(LOADER_V3_PROGRAM_ADDRESS);

/**
 * An enumeration of valid LoaderV3InstructionType's
 */
export type LoaderV3InstructionType =
  | "InitializeBuffer"
  | "Write"
  | "DeployWithMaxDataLen"
  | "Upgrade"
  | "SetAuthority"
  | "Close"
  | "ExtendProgram"
  | "SetAuthorityChecked";

export type InitializeBufferParams = {
  /** Source account to initialize. */
  sourceAccount: Address;
  /** Buffer authority. */
  bufferAuthority: Address;
};

export type WriteParams = {
  /** Buffer account. */
  bufferAccount: Address;
  /** Buffer authority. */
  bufferAuthority: Address;
  /** Offset into the buffer to write. */
  offset: number;
  /** Bytes to write. */
  bytes: ReadonlyUint8Array | Uint8Array;
};

export type DeployWithMaxDataLenParams = {
  /** Payer account that will pay to create the ProgramData account. */
  payerAccount: Address;
  /** ProgramData account (uninitialized). */
  programDataAccount: Address;
  /** Program account (uninitialized). */
  programAccount: Address;
  /** Buffer account where the program data has been written. */
  bufferAccount: Address;
  /** Authority. */
  authority: Address;
  /** Maximum program data length. */
  maxDataLen: number | bigint;
  /** Rent sysvar. */
  rentSysvar?: Address;
  /** Clock sysvar. */
  clockSysvar?: Address;
  /** System program. */
  systemProgram?: Address;
};

export type UpgradeParams = {
  /** ProgramData account. */
  programDataAccount: Address;
  /** Program account. */
  programAccount: Address;
  /** Buffer account where the new program data has been written. */
  bufferAccount: Address;
  /** Spill account. */
  spillAccount: Address;
  /** Authority. */
  authority: Address;
  /** Rent sysvar. */
  rentSysvar?: Address;
  /** Clock sysvar. */
  clockSysvar?: Address;
};

export type SetAuthorityParams = {
  /** Buffer or ProgramData account. */
  bufferOrProgramDataAccount: Address;
  /** Current authority. */
  currentAuthority: Address;
  /** New authority. */
  newAuthority?: Address;
};

export type SetAuthorityCheckedParams = {
  /** Buffer or ProgramData account to change the authority of. */
  bufferOrProgramDataAccount: Address;
  /** Current authority. */
  currentAuthority: Address;
  /** New authority. */
  newAuthority: Address;
};

export type CloseParams = {
  /** Buffer or ProgramData account to close. */
  bufferOrProgramDataAccount: Address;
  /** Destination account for reclaimed lamports. */
  destinationAccount: Address;
  /** Authority. */
  authority?: Address;
  /** Program account. */
  programAccount?: Address;
};

export type ExtendProgramParams = {
  /** ProgramData account. */
  programDataAccount: Address;
  /** Program account. */
  programAccount: Address;
  /** Additional bytes to allocate. */
  additionalBytes: number;
  /** System program. */
  systemProgram?: Address;
  /** Payer. */
  payer?: Address;
};

const GENERATED_TO_LEGACY_INSTRUCTION_TYPE = {
  [GeneratedLoaderV3Instruction.InitializeBuffer]: "InitializeBuffer",
  [GeneratedLoaderV3Instruction.Write]: "Write",
  [GeneratedLoaderV3Instruction.DeployWithMaxDataLen]: "DeployWithMaxDataLen",
  [GeneratedLoaderV3Instruction.Upgrade]: "Upgrade",
  [GeneratedLoaderV3Instruction.SetAuthority]: "SetAuthority",
  [GeneratedLoaderV3Instruction.Close]: "Close",
  [GeneratedLoaderV3Instruction.ExtendProgram]: "ExtendProgram",
  [GeneratedLoaderV3Instruction.SetAuthorityChecked]: "SetAuthorityChecked",
} as const satisfies Record<GeneratedLoaderV3Instruction, string>;

type ParsedAnyLoaderV3Instruction = ParsedLoaderV3Instruction<string>;

type ParsedInstructionOfType<TInstructionType extends GeneratedLoaderV3Instruction> = Extract<
  ParsedAnyLoaderV3Instruction,
  { instructionType: TInstructionType }
>;

function getInstructionType(instruction: TransactionInstruction): LoaderV3InstructionType {
  checkProgramId(instruction.programId);
  return GENERATED_TO_LEGACY_INSTRUCTION_TYPE[
    identifyLoaderV3Instruction(instruction.data)
  ];
}

function parseLoaderV3InstructionOfType<TInstructionType extends GeneratedLoaderV3Instruction>(
  instruction: TransactionInstruction,
  expectedInstructionType: TInstructionType,
): ParsedInstructionOfType<TInstructionType> {
  checkProgramId(instruction.programId);
  const parsedInstruction = parseLoaderV3Instruction(fromWeb3Instruction(instruction));
  if (parsedInstruction.instructionType !== expectedInstructionType) {
    throw new Error("invalid instruction; instruction type mismatch");
  }
  return parsedInstruction as ParsedInstructionOfType<TInstructionType>;
}

function checkProgramId(programId: Address) {
  if (!programId.equals(LoaderV3Program.programId)) {
    throw new Error("invalid instruction; programId is not LoaderV3Program");
  }
}

/**
 * Loader V3 Instruction class
 */
export class LoaderV3Instruction {
  /**
   * @internal
   */
  constructor() {}

  /**
   * Decode a loader v3 instruction and retrieve the instruction type.
   */
  static decodeInstructionType(instruction: TransactionInstruction): LoaderV3InstructionType {
    return getInstructionType(instruction);
  }

  /**
   * Decode an initialize buffer instruction and retrieve the instruction params.
   */
  static decodeInitializeBuffer(instruction: TransactionInstruction): InitializeBufferParams {
    const parsedInstruction = parseLoaderV3InstructionOfType(
      instruction,
      GeneratedLoaderV3Instruction.InitializeBuffer,
    );

    return {
      sourceAccount: new Address(parsedInstruction.accounts.sourceAccount.address),
      bufferAuthority: new Address(parsedInstruction.accounts.bufferAuthority.address),
    };
  }

  /**
   * Decode a write instruction and retrieve the instruction params.
   */
  static decodeWrite(instruction: TransactionInstruction): WriteParams {
    const parsedInstruction = parseLoaderV3InstructionOfType(
      instruction,
      GeneratedLoaderV3Instruction.Write,
    );

    return {
      bufferAccount: new Address(parsedInstruction.accounts.bufferAccount.address),
      bufferAuthority: new Address(parsedInstruction.accounts.bufferAuthority.address),
      offset: parsedInstruction.data.offset,
      bytes: Uint8Array.from(parsedInstruction.data.bytes),
    };
  }

  /**
   * Decode a deploy with max data len instruction and retrieve the instruction params.
   */
  static decodeDeployWithMaxDataLen(
    instruction: TransactionInstruction,
  ): DeployWithMaxDataLenParams {
    const parsedInstruction = parseLoaderV3InstructionOfType(
      instruction,
      GeneratedLoaderV3Instruction.DeployWithMaxDataLen,
    );

    return {
      payerAccount: new Address(parsedInstruction.accounts.payerAccount.address),
      programDataAccount: new Address(parsedInstruction.accounts.programDataAccount.address),
      programAccount: new Address(parsedInstruction.accounts.programAccount.address),
      bufferAccount: new Address(parsedInstruction.accounts.bufferAccount.address),
      authority: new Address(parsedInstruction.accounts.authority.address),
      maxDataLen: parsedInstruction.data.maxDataLen,
      rentSysvar: new Address(parsedInstruction.accounts.rentSysvar.address),
      clockSysvar: new Address(parsedInstruction.accounts.clockSysvar.address),
      systemProgram: new Address(parsedInstruction.accounts.systemProgram.address),
    };
  }

  /**
   * Decode an upgrade instruction and retrieve the instruction params.
   */
  static decodeUpgrade(instruction: TransactionInstruction): UpgradeParams {
    const parsedInstruction = parseLoaderV3InstructionOfType(
      instruction,
      GeneratedLoaderV3Instruction.Upgrade,
    );

    return {
      programDataAccount: new Address(parsedInstruction.accounts.programDataAccount.address),
      programAccount: new Address(parsedInstruction.accounts.programAccount.address),
      bufferAccount: new Address(parsedInstruction.accounts.bufferAccount.address),
      spillAccount: new Address(parsedInstruction.accounts.spillAccount.address),
      authority: new Address(parsedInstruction.accounts.authority.address),
      rentSysvar: new Address(parsedInstruction.accounts.rentSysvar.address),
      clockSysvar: new Address(parsedInstruction.accounts.clockSysvar.address),
    };
  }

  /**
   * Decode a set authority instruction and retrieve the instruction params.
   */
  static decodeSetAuthority(instruction: TransactionInstruction): SetAuthorityParams {
    const parsedInstruction = parseLoaderV3InstructionOfType(
      instruction,
      GeneratedLoaderV3Instruction.SetAuthority,
    );

    return {
      bufferOrProgramDataAccount: new Address(
        parsedInstruction.accounts.bufferOrProgramDataAccount.address,
      ),
      currentAuthority: new Address(parsedInstruction.accounts.currentAuthority.address),
      ...(parsedInstruction.accounts.newAuthority
        ? {
            newAuthority: new Address(parsedInstruction.accounts.newAuthority.address),
          }
        : {}),
    };
  }

  /**
   * Decode a set authority checked instruction and retrieve the instruction params.
   */
  static decodeSetAuthorityChecked(
    instruction: TransactionInstruction,
  ): SetAuthorityCheckedParams {
    const parsedInstruction = parseLoaderV3InstructionOfType(
      instruction,
      GeneratedLoaderV3Instruction.SetAuthorityChecked,
    );

    return {
      bufferOrProgramDataAccount: new Address(
        parsedInstruction.accounts.bufferOrProgramDataAccount.address,
      ),
      currentAuthority: new Address(parsedInstruction.accounts.currentAuthority.address),
      newAuthority: new Address(parsedInstruction.accounts.newAuthority.address),
    };
  }

  /**
   * Decode a close instruction and retrieve the instruction params.
   */
  static decodeClose(instruction: TransactionInstruction): CloseParams {
    const parsedInstruction = parseLoaderV3InstructionOfType(
      instruction,
      GeneratedLoaderV3Instruction.Close,
    );

    return {
      bufferOrProgramDataAccount: new Address(
        parsedInstruction.accounts.bufferOrProgramDataAccount.address,
      ),
      destinationAccount: new Address(parsedInstruction.accounts.destinationAccount.address),
      ...(parsedInstruction.accounts.authority
        ? {
            authority: new Address(parsedInstruction.accounts.authority.address),
          }
        : {}),
      ...(parsedInstruction.accounts.programAccount
        ? {
            programAccount: new Address(parsedInstruction.accounts.programAccount.address),
          }
        : {}),
    };
  }

  /**
   * Decode an extend program instruction and retrieve the instruction params.
   */
  static decodeExtendProgram(instruction: TransactionInstruction): ExtendProgramParams {
    const parsedInstruction = parseLoaderV3InstructionOfType(
      instruction,
      GeneratedLoaderV3Instruction.ExtendProgram,
    );

    return {
      programDataAccount: new Address(parsedInstruction.accounts.programDataAccount.address),
      programAccount: new Address(parsedInstruction.accounts.programAccount.address),
      additionalBytes: parsedInstruction.data.additionalBytes,
      ...(parsedInstruction.accounts.systemProgram
        ? {
            systemProgram: new Address(parsedInstruction.accounts.systemProgram.address),
          }
        : {}),
      ...(parsedInstruction.accounts.payer
        ? {
            payer: new Address(parsedInstruction.accounts.payer.address),
          }
        : {}),
    };
  }
}

/**
 * Factory class for transaction instructions to interact with the Loader V3 program
 */
export class LoaderV3Program {
  /**
   * @internal
   */
  constructor() {}

  /**
   * Public key that identifies the Loader V3 program
   */
  static programId: Address = LOADER_V3_PROGRAM_ID;

  static initializeBuffer(params: InitializeBufferParams): TransactionInstruction {
    return toWeb3Instruction(
      getInitializeBufferInstruction({
        sourceAccount: params.sourceAccount.toBase58(),
        bufferAuthority: params.bufferAuthority.toBase58(),
      }),
    );
  }

  static write(params: WriteParams): TransactionInstruction {
    return toWeb3Instruction(
      getWriteInstruction({
        bufferAccount: params.bufferAccount.toBase58(),
        bufferAuthority: createNoopSigner(params.bufferAuthority.toBase58()),
        offset: params.offset,
        bytes: params.bytes,
      }),
    );
  }

  static deployWithMaxDataLen(params: DeployWithMaxDataLenParams): TransactionInstruction {
    return toWeb3Instruction(
      getDeployWithMaxDataLenInstruction({
        payerAccount: createNoopSigner(params.payerAccount.toBase58()),
        programDataAccount: params.programDataAccount.toBase58(),
        programAccount: params.programAccount.toBase58(),
        bufferAccount: params.bufferAccount.toBase58(),
        authority: createNoopSigner(params.authority.toBase58()),
        maxDataLen: params.maxDataLen,
        ...(params.rentSysvar ? { rentSysvar: params.rentSysvar.toBase58() } : {}),
        ...(params.clockSysvar ? { clockSysvar: params.clockSysvar.toBase58() } : {}),
        ...(params.systemProgram ? { systemProgram: params.systemProgram.toBase58() } : {}),
      }),
    );
  }

  static upgrade(params: UpgradeParams): TransactionInstruction {
    return toWeb3Instruction(
      getUpgradeInstruction({
        programDataAccount: params.programDataAccount.toBase58(),
        programAccount: params.programAccount.toBase58(),
        bufferAccount: params.bufferAccount.toBase58(),
        spillAccount: params.spillAccount.toBase58(),
        authority: createNoopSigner(params.authority.toBase58()),
        ...(params.rentSysvar ? { rentSysvar: params.rentSysvar.toBase58() } : {}),
        ...(params.clockSysvar ? { clockSysvar: params.clockSysvar.toBase58() } : {}),
      }),
    );
  }

  static setAuthority(params: SetAuthorityParams): TransactionInstruction {
    return toWeb3Instruction(
      getSetAuthorityInstruction({
        bufferOrProgramDataAccount: params.bufferOrProgramDataAccount.toBase58(),
        currentAuthority: createNoopSigner(params.currentAuthority.toBase58()),
        ...(params.newAuthority ? { newAuthority: params.newAuthority.toBase58() } : {}),
      }),
    );
  }

  static setAuthorityChecked(params: SetAuthorityCheckedParams): TransactionInstruction {
    return toWeb3Instruction(
      getSetAuthorityCheckedInstruction({
        bufferOrProgramDataAccount: params.bufferOrProgramDataAccount.toBase58(),
        currentAuthority: createNoopSigner(params.currentAuthority.toBase58()),
        newAuthority: createNoopSigner(params.newAuthority.toBase58()),
      }),
    );
  }

  static close(params: CloseParams): TransactionInstruction {
    return toWeb3Instruction(
      getCloseInstruction({
        bufferOrProgramDataAccount: params.bufferOrProgramDataAccount.toBase58(),
        destinationAccount: params.destinationAccount.toBase58(),
        ...(params.authority
          ? { authority: createNoopSigner(params.authority.toBase58()) }
          : {}),
        ...(params.programAccount ? { programAccount: params.programAccount.toBase58() } : {}),
      }),
    );
  }

  static extendProgram(params: ExtendProgramParams): TransactionInstruction {
    return toWeb3Instruction(
      getExtendProgramInstruction({
        programDataAccount: params.programDataAccount.toBase58(),
        programAccount: params.programAccount.toBase58(),
        additionalBytes: params.additionalBytes,
        ...(params.systemProgram ? { systemProgram: params.systemProgram.toBase58() } : {}),
        ...(params.payer ? { payer: createNoopSigner(params.payer.toBase58()) } : {}),
      }),
    );
  }
}
