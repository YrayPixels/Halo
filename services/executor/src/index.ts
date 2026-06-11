import { config } from "dotenv";
import { PublicKey } from "@solana/web3.js";
import { Redis } from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optionalEnv, requireEnv } from "@halo/shared";
import { startRetryConsumer } from "./consume-retries.js";
import { loadKeypairFromEnv } from "./keypair.js";
import { submitTransferBundle } from "./submit-bundle.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

config({ path: resolve(rootDir, ".env") });

async function main(): Promise<void> {
  const rpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  const blockEngineUrl = optionalEnv("JITO_BLOCK_ENGINE_URL", "mainnet.block-engine.jito.wtf");
  const redisUrl = optionalEnv("REDIS_URL", "redis://localhost:6379");
  const transferLamports = Number(optionalEnv("TRANSFER_LAMPORTS", "1000"));
  const daemonMode = optionalEnv("EXECUTOR_DAEMON", "false") === "true";

  if (!Number.isFinite(transferLamports) || transferLamports <= 0) {
    throw new Error("TRANSFER_LAMPORTS must be a positive number");
  }

  const payer = loadKeypairFromEnv("EXECUTOR_PRIVATE_KEY");
  const destination = new PublicKey(requireEnv("TRANSFER_DESTINATION"));
  const redis = new Redis(redisUrl);

  console.log("HALO executor starting");
  console.log(`Solana RPC: ${rpcUrl}`);
  console.log(`Jito block engine: ${blockEngineUrl}`);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`Destination: ${destination.toBase58()}`);
  console.log(`Mode: ${daemonMode ? "daemon (retry listener)" : "single submit"}`);

  const sharedOptions = {
    rpcUrl,
    blockEngineUrl,
    payer,
    destination,
    transferLamports,
  };

  let stopRetryConsumer: (() => void) | undefined;

  if (daemonMode) {
    stopRetryConsumer = await startRetryConsumer(redis, sharedOptions);
    console.log("Listening for agent retry requests on Redis...");
  } else {
    const bundleId = await submitTransferBundle({
      ...sharedOptions,
      redis,
    });

    console.log(`Submitted bundle ${bundleId}`);
    await redis.quit();
    return;
  }

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down executor`);
    stopRetryConsumer?.();
    await redis.quit();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
