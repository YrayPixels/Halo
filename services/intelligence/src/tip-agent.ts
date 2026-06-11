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

function booleanEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }

  return value === "true" || value === "1";
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(optionalEnv(name, String(fallback)));
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export async function refreshTipTelemetry(redis: Redis): Promise<void> {
  const rpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  const floorTip = Number(optionalEnv("JITO_MIN_TIP_LAMPORTS", optionalEnv("JITO_TIP_LAMPORTS", "0")));
  const includeTipAccountActivity = booleanEnv("TIP_AGENT_SAMPLE_TIP_ACCOUNTS", false);
  const connection = new Connection(rpcUrl, "confirmed");

  const recommendation = await calculateDynamicTip(connection, {
    mode: "steady",
    floorTip,
    medianFeeMultiplier: positiveIntegerEnv("TIP_AGENT_MEDIAN_FEE_MULTIPLIER", 8),
    includeTipAccountActivity,
    tipAccountLimit: positiveIntegerEnv("TIP_AGENT_TIP_ACCOUNT_LIMIT", 2),
    signaturesPerTipAccount: positiveIntegerEnv("TIP_AGENT_SIGNATURES_PER_ACCOUNT", 2),
  });

  await Promise.all([
    redis.set(REDIS_KEYS.recommendedTip, String(recommendation.tipLamports)),
    redis.set(REDIS_KEYS.networkMedianPriorityFee, String(recommendation.networkMedianFee)),
    redis.set(REDIS_KEYS.tipAccountActivity, String(recommendation.recentTipActivity)),
  ]);

  await recordTelemetryComm(redis, {
    fromAgent: "tip_ext",
    toAgent: "tip_int",
    message: includeTipAccountActivity
      ? `Observed median priority fee ${recommendation.networkMedianFee} lamports and sampled Jito tip-account inflow ${recommendation.recentTipActivity} lamports.`
      : `Observed median priority fee ${recommendation.networkMedianFee} lamports; tip-account sampling disabled to avoid RPC rate limits.`,
  });

  await recordTelemetryComm(redis, {
    fromAgent: "tip_int",
    toAgent: "aggregator",
    message: `Steady Tip Agent recommends ${recommendation.tipLamports} lamports (${recommendation.reasoning})`,
  });

  console.log(`Tip Agent steady recommendation: ${recommendation.tipLamports} lamports`);
}

