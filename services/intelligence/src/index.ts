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

function createNonOverlappingTick(label: string, task: () => Promise<void>): () => void {
  let running = false;

  return () => {
    if (running) {
      console.warn(`${label} tick skipped; previous tick still running`);
      return;
    }

    running = true;
    void task().finally(() => {
      running = false;
    });
  };
}

async function main(): Promise<void> {
  const redisUrl = optionalEnv("REDIS_URL", "redis://localhost:6379");
  const redis = new Redis(redisUrl);

  console.log("HALO intelligence starting");
  console.log(`Redis: ${redisUrl}`);
  console.log(`LLM: ${optionalEnv("OPENAI_API_KEY") ? "enabled" : "heuristic fallback"}`);

  const failureTick = createNonOverlappingTick("Failure processing", async () => {
    try {
      await processPendingFailures(redis);
    } catch (error) {
      console.error("Failure processing tick failed:", error);
    }
  });
  const tipTick = createNonOverlappingTick("Tip Agent telemetry", async () => {
    try {
      await refreshTipTelemetry(redis);
    } catch (error) {
      console.error("Tip Agent telemetry tick failed:", error);
    }
  });
  const leaderTick = createNonOverlappingTick("Leader Agent telemetry", async () => {
    try {
      await refreshLeaderTelemetry(redis);
    } catch (error) {
      console.error("Leader Agent telemetry tick failed:", error);
    }
  });

  failureTick();
  tipTick();
  leaderTick();
  const failureInterval = setInterval(() => void failureTick(), 3_000);
  const tipIntervalMs = positiveNumberEnv("TIP_AGENT_INTERVAL_MS", 120_000);
  const leaderIntervalMs = positiveNumberEnv("LEADER_AGENT_INTERVAL_MS", 30_000);
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
