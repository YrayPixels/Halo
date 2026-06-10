import { optionalEnv } from "@halo/shared";

async function main(): Promise<void> {
  const solanaRpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");

  console.log("HALO executor starting");
  console.log(`Solana RPC: ${solanaRpcUrl}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
