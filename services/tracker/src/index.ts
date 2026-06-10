import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optionalEnv, requireEnv } from "@halo/shared";
import { loadTrackedSignatures, pollSignatureStatuses } from "./lifecycle.js";
import { startLifecycleStream } from "./stream.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

config({ path: resolve(rootDir, ".env") });

async function main(): Promise<void> {
  const rpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  const yellowstoneGrpcUrl = requireEnv("YELLOWSTONE_GRPC_URL");
  const yellowstoneGrpcToken = optionalEnv("YELLOWSTONE_GRPC_TOKEN") || undefined;

  let watchlist = await loadTrackedSignatures();

  console.log("HALO tracker starting");
  console.log(`Solana RPC: ${rpcUrl}`);
  console.log(`Yellowstone: ${yellowstoneGrpcUrl}`);
  console.log(`Watching ${watchlist.size} active signature(s)`);

  const stopStream = await startLifecycleStream(
    yellowstoneGrpcUrl,
    yellowstoneGrpcToken,
    () => watchlist,
  );

  const refreshWatchlist = async () => {
    watchlist = await loadTrackedSignatures();
  };

  const pollInterval = setInterval(() => {
    void pollSignatureStatuses(rpcUrl, watchlist).catch((error: unknown) => {
      console.error("Signature poll failed:", error);
    });
  }, 5_000);

  const watchlistInterval = setInterval(() => {
    void refreshWatchlist().catch((error: unknown) => {
      console.error("Watchlist refresh failed:", error);
    });
  }, 3_000);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down tracker`);
    clearInterval(pollInterval);
    clearInterval(watchlistInterval);
    stopStream();
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
