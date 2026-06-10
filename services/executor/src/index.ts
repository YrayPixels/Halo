import { config } from "dotenv";
import { PublicKey } from "@solana/web3.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optionalEnv, requireEnv } from "@halo/shared";
import { loadKeypairFromEnv } from "./keypair.js";
import { submitTransferBundle } from "./submit-bundle.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

config({ path: resolve(rootDir, ".env") });

async function main(): Promise<void> {
  const rpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  const blockEngineUrl = optionalEnv("JITO_BLOCK_ENGINE_URL", "mainnet.block-engine.jito.wtf");
  const transferLamports = Number(optionalEnv("TRANSFER_LAMPORTS", "1000"));
  const tipLamports = Number(optionalEnv("JITO_TIP_LAMPORTS", "10000"));

  if (!Number.isFinite(transferLamports) || transferLamports <= 0) {
    throw new Error("TRANSFER_LAMPORTS must be a positive number");
  }

  if (!Number.isFinite(tipLamports) || tipLamports <= 0) {
    throw new Error("JITO_TIP_LAMPORTS must be a positive number");
  }

  const payer = loadKeypairFromEnv("EXECUTOR_PRIVATE_KEY");
  const destination = new PublicKey(requireEnv("TRANSFER_DESTINATION"));

  console.log("HALO executor starting");
  console.log(`Solana RPC: ${rpcUrl}`);
  console.log(`Jito block engine: ${blockEngineUrl}`);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`Destination: ${destination.toBase58()}`);

  const bundleId = await submitTransferBundle({
    rpcUrl,
    blockEngineUrl,
    payer,
    destination,
    transferLamports,
    tipLamports,
  });

  console.log(`Submitted bundle ${bundleId}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
