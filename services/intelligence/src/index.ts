import { config } from "dotenv";
import { Redis } from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optionalEnv } from "@halo/shared";
import { refreshLeaderTelemetry } from "./leader-agent.js";
import { processPendingFailures } from "./process-failures.js";
import { refreshTipTelemetry } from "./tip-agent.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

config({ path: resolve(rootDir, ".env") });

function positiveNumberEnv(name: string, fallback: number): number {
  const value = Number(optionalEnv(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const redisUrl = optionalEnv("REDIS_URL", "redis://localhost:6379");
  const redis = new Redis(redisUrl);

  console.log("HALO intelligence starting");
  console.log(`Redis: ${redisUrl}`);
  console.log(`LLM: ${optionalEnv("OPENAI_API_KEY") ? "enabled" : "heuristic fallback"}`);

  const failureTick = async () => {
    try {
      await processPendingFailures(redis);
    } catch (error) {
      console.error("Failure processing tick failed:", error);
    }
  };
  const tipTick = async () => {
    try {
      await refreshTipTelemetry(redis);
    } catch (error) {
      console.error("Tip Agent telemetry tick failed:", error);
    }
  };
  const leaderTick = async () => {
    try {
      await refreshLeaderTelemetry(redis);
    } catch (error) {
      console.error("Leader Agent telemetry tick failed:", error);
    }
  };

  void failureTick();
  void tipTick();
  void leaderTick();
  const failureInterval = setInterval(() => void failureTick(), 3_000);
  const tipIntervalMs = positiveNumberEnv("TIP_AGENT_INTERVAL_MS", 30_000);
  const leaderIntervalMs = positiveNumberEnv("LEADER_AGENT_INTERVAL_MS", 15_000);
  const tipInterval = setInterval(() => void tipTick(), tipIntervalMs);
  const leaderInterval = setInterval(() => void leaderTick(), leaderIntervalMs);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down intelligence`);
    clearInterval(failureInterval);
    clearInterval(tipInterval);
    clearInterval(leaderInterval);
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
