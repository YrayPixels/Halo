import { config } from "dotenv";
import { Redis } from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optionalEnv, requireEnv } from "@halo/shared";
import { startSlotStream } from "./slot-stream.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

config({ path: resolve(rootDir, ".env") });

async function main(): Promise<void> {
  const redisUrl = optionalEnv("REDIS_URL", "redis://localhost:6379");
  const yellowstoneGrpcUrl = requireEnv("YELLOWSTONE_GRPC_URL");
  const yellowstoneGrpcToken = optionalEnv("YELLOWSTONE_GRPC_TOKEN") || undefined;

  const redis = new Redis(redisUrl);
  await redis.ping();

  console.log("HALO watcher starting");
  console.log(`Redis: ${redisUrl}`);
  console.log(`Yellowstone: ${yellowstoneGrpcUrl}`);

  const stopSlotStream = await startSlotStream(yellowstoneGrpcUrl, yellowstoneGrpcToken, redis);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down watcher`);
    stopSlotStream();
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
