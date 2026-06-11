import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type SolanaCliConfig = {
  keypairPath: string;
  jsonRpcUrl: string;
};

export const DEFAULT_SOLANA_CONFIG_PATH = join(homedir(), ".config/solana/cli/config.yml");

export function parseSolanaCliConfig(content: string): Partial<SolanaCliConfig> {
  const result: Partial<SolanaCliConfig> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("keypair_path:")) {
      result.keypairPath = trimmed.slice("keypair_path:".length).trim();
    } else if (trimmed.startsWith("json_rpc_url:")) {
      result.jsonRpcUrl = trimmed.slice("json_rpc_url:".length).trim();
    }
  }

  return result;
}

export function expandHomePath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export async function loadSolanaCliConfig(
  configPath: string = DEFAULT_SOLANA_CONFIG_PATH,
): Promise<SolanaCliConfig> {
  const content = await readFile(configPath, "utf8");
  const parsed = parseSolanaCliConfig(content);

  if (!parsed.keypairPath) {
    throw new Error(`Missing keypair_path in Solana CLI config: ${configPath}`);
  }
  if (!parsed.jsonRpcUrl) {
    throw new Error(`Missing json_rpc_url in Solana CLI config: ${configPath}`);
  }

  return {
    keypairPath: expandHomePath(parsed.keypairPath),
    jsonRpcUrl: parsed.jsonRpcUrl,
  };
}
