import { Connection } from "@solana/web3.js";
import type { Redis } from "ioredis";
import { saveAgentComm } from "@halo/database";
import { optionalEnv, publishAgentComm, REDIS_KEYS } from "@halo/shared";
import { calculateDynamicTip } from "./tip-intelligence.js";

async function recordTelemetryComm(
  redis: Redis,
  options: {
    fromAgent: string;
    toAgent: string;
    message: string;
  },
): Promise<void> {
  await saveAgentComm(options);
  await publishAgentComm(redis, {
    ...options,
    observedAt: new Date().toISOString(),
  });
}

export async function refreshTipTelemetry(redis: Redis): Promise<void> {
  const rpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  const floorTip = Number(optionalEnv("JITO_MIN_TIP_LAMPORTS", optionalEnv("JITO_TIP_LAMPORTS", "0")));
  const connection = new Connection(rpcUrl, "confirmed");

  const recommendation = await calculateDynamicTip(connection, {
    failureClass: "UNKNOWN",
    currentTip: BigInt(floorTip),
    floorTip,
  });

  await Promise.all([
    redis.set(REDIS_KEYS.recommendedTip, String(recommendation.tipLamports)),
    redis.set(REDIS_KEYS.networkMedianPriorityFee, String(recommendation.networkMedianFee)),
    redis.set(REDIS_KEYS.tipAccountActivity, String(recommendation.recentTipActivity)),
  ]);

  await recordTelemetryComm(redis, {
    fromAgent: "tip_ext",
    toAgent: "tip_int",
    message: `Observed median priority fee ${recommendation.networkMedianFee} lamports and Jito tip-account inflow ${recommendation.recentTipActivity} lamports.`,
  });

  await recordTelemetryComm(redis, {
    fromAgent: "tip_int",
    toAgent: "aggregator",
    message: `Steady Tip Agent recommends ${recommendation.tipLamports} lamports from ${recommendation.source}.`,
  });

  console.log(`Tip Agent steady recommendation: ${recommendation.tipLamports} lamports`);
}

