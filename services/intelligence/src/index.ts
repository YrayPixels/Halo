import { config } from "dotenv";
import { Redis } from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optionalEnv } from "@halo/shared";
import { processPendingFailures } from "./process-failures.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

config({ path: resolve(rootDir, ".env") });

async function main(): Promise<void> {
  const redisUrl = optionalEnv("REDIS_URL", "redis://localhost:6379");
  const redis = new Redis(redisUrl);

  console.log("HALO intelligence starting");
  console.log(`Redis: ${redisUrl}`);
  console.log(`LLM: ${optionalEnv("OPENAI_API_KEY") ? "enabled" : "heuristic fallback"}`);

  const tick = async () => {
    try {
      await processPendingFailures(redis);
    } catch (error) {
      console.error("Failure processing tick failed:", error);
    }
  };

  void tick();
  const interval = setInterval(() => void tick(), 3_000);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down intelligence`);
    clearInterval(interval);
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
