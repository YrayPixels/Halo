import { config } from "dotenv";
import { Connection } from "@solana/web3.js";
import { Redis } from "ioredis";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { advanceTransactionStatus, loadTrackedSignatures } from "@halo/database";
import { optionalEnv } from "@halo/shared";
import type { TransactionStatus } from "@halo/types";
import { startEventConsumer } from "./consume-events.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

config({ path: resolve(rootDir, ".env") });

async function pollSignatureStatuses(
  connection: Connection,
  watchlist: Map<string, TransactionStatus>,
): Promise<void> {
  if (watchlist.size === 0) {
    return;
  }

  const signatures = [...watchlist.keys()];
  const response = await connection.getSignatureStatuses(signatures, {
    searchTransactionHistory: true,
  });

  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index]!;
    const status = response.value[index];

    if (!status) {
      continue;
    }

    if (status.err) {
      await advanceTransactionStatus(signature, "FAILED");
      continue;
    }

    const slot =
      status.slot !== null && status.slot !== undefined ? BigInt(status.slot) : undefined;
    const confirmationStatus = status.confirmationStatus;

    if (confirmationStatus === "finalized") {
      await advanceTransactionStatus(signature, "FINALIZED", { slot });
      continue;
    }

    if (confirmationStatus === "confirmed") {
      await advanceTransactionStatus(signature, "CONFIRMED", { slot });
    }
  }
}

async function main(): Promise<void> {
  const rpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  const redisUrl = optionalEnv("REDIS_URL", "redis://localhost:6379");
  const connection = new Connection(rpcUrl, "confirmed");
  const redis = new Redis(redisUrl);

  let watchlist = await loadTrackedSignatures();

  console.log("HALO tracker starting");
  console.log(`Solana RPC: ${rpcUrl}`);
  console.log(`Redis: ${redisUrl}`);
  console.log(`Watching ${watchlist.size} active signature(s)`);
  console.log(`Consuming lifecycle events from Redis stream on ${hostname()}`);

  const stopEventConsumer = await startEventConsumer(redis);

  const refreshWatchlist = async () => {
    watchlist = await loadTrackedSignatures();
  };

  void pollSignatureStatuses(connection, watchlist).catch((error: unknown) => {
    console.error("Initial signature poll failed:", error);
  });

  const pollInterval = setInterval(() => {
    void pollSignatureStatuses(connection, watchlist).catch((error: unknown) => {
      console.error("Signature poll failed:", error);
    });
  }, 2_000);

  const watchlistInterval = setInterval(() => {
    void refreshWatchlist().catch((error: unknown) => {
      console.error("Watchlist refresh failed:", error);
    });
  }, 3_000);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down tracker`);
    clearInterval(pollInterval);
    clearInterval(watchlistInterval);
    stopEventConsumer();
    await redis.quit();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
