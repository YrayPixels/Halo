import { config } from "dotenv";
import { Connection } from "@solana/web3.js";
import { Redis } from "ioredis";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTrackedSignatures } from "@halo/database";
import { enqueueLifecycleSignature, listLifecycleQueue, optionalEnv } from "@halo/shared";
import type { TransactionStatus } from "@halo/types";
import { hydrateLifecycleQueue, startEventConsumer } from "./consume-events.js";
import { promoteLifecycleQueue } from "./promote-queue.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

config({ path: resolve(rootDir, ".env") });

async function syncWatchlistToQueue(
  redis: Redis,
  watchlist: Map<string, TransactionStatus>,
): Promise<void> {
  const queued = new Set((await listLifecycleQueue(redis)).map((entry) => entry.signature));

  for (const [signature, status] of watchlist) {
    if (
      (status === "SUBMITTED" || status === "PROCESSED" || status === "CONFIRMED") &&
      !queued.has(signature)
    ) {
      await enqueueLifecycleSignature(redis, signature, status);
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
  console.log(`Lifecycle queue: Yellowstone ingress + RPC promotion`);
  console.log(`Consuming lifecycle events from Redis stream on ${hostname()}`);

  await hydrateLifecycleQueue(redis, watchlist);

  const stopEventConsumer = await startEventConsumer(redis);

  const refreshWatchlist = async () => {
    watchlist = await loadTrackedSignatures();
    await syncWatchlistToQueue(redis, watchlist);
  };

  void promoteLifecycleQueue(connection, redis).catch((error: unknown) => {
    console.error("Initial lifecycle promotion failed:", error);
  });

  const pollInterval = setInterval(() => {
    void promoteLifecycleQueue(connection, redis).catch((error: unknown) => {
      console.error("Lifecycle promotion failed:", error);
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
