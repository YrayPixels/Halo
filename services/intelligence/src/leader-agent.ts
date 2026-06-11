import { Connection } from "@solana/web3.js";
import type { Redis } from "ioredis";
import { saveAgentComm } from "@halo/database";
import { optionalEnv, publishAgentComm, REDIS_KEYS } from "@halo/shared";
import { searcherClient } from "./jito-searcher.js";

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

function parseSlot(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function refreshLeaderTelemetry(redis: Redis): Promise<void> {
  const rpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  const blockEngineUrl = optionalEnv("JITO_BLOCK_ENGINE_URL", "mainnet.block-engine.jito.wtf");
  const connection = new Connection(rpcUrl, "confirmed");

  const currentSlot =
    parseSlot(await redis.get(REDIS_KEYS.networkCurrentSlot)) ?? (await connection.getSlot("confirmed"));

  const currentLeader = await connection
    .getSlotLeaders(currentSlot, 1)
    .then((leaders) => leaders[0]?.toBase58() ?? null)
    .catch((error: unknown) => {
      console.warn("Failed to resolve current slot leader:", error);
      return null;
    });

  if (currentLeader) {
    await redis.set(REDIS_KEYS.networkCurrentLeader, currentLeader);
  }

  let nextJitoLeaderSlot: number | undefined;
  let nextJitoLeaderIdentity: string | undefined;
  let nextJitoLeaderSlotsAway: number | undefined;

  try {
    const searcher = searcherClient(blockEngineUrl);
    const leader = await searcher.getNextScheduledLeader();

    if (leader.ok) {
      nextJitoLeaderSlot = leader.value.nextLeaderSlot;
      nextJitoLeaderIdentity = leader.value.nextLeaderIdentity;
      nextJitoLeaderSlotsAway = leader.value.nextLeaderSlot - currentSlot;

      await Promise.all([
        redis.set(REDIS_KEYS.nextJitoLeaderSlot, String(nextJitoLeaderSlot)),
        redis.set(REDIS_KEYS.nextJitoLeaderIdentity, nextJitoLeaderIdentity),
        redis.set(REDIS_KEYS.nextJitoLeaderSlotsAway, String(nextJitoLeaderSlotsAway)),
        redis.set(REDIS_KEYS.recommendedSubmitSlot, String(nextJitoLeaderSlot)),
      ]);
    }
  } catch (error) {
    console.warn("Failed to fetch Jito leader schedule:", error);
  }

  if (currentLeader) {
    await recordTelemetryComm(redis, {
      fromAgent: "leader_ext",
      toAgent: "leader_int",
      message: `Slot ${currentSlot} leader is ${currentLeader}.`,
    });
  }

  if (nextJitoLeaderIdentity !== undefined && nextJitoLeaderSlotsAway !== undefined) {
    const timingNote =
      nextJitoLeaderSlotsAway <= 2
        ? `Jito leader in ${nextJitoLeaderSlotsAway} slots at ${nextJitoLeaderSlot}`
        : `Next Jito leader in ${nextJitoLeaderSlotsAway} slots at ${nextJitoLeaderSlot}`;

    await recordTelemetryComm(redis, {
      fromAgent: "leader_int",
      toAgent: "timing",
      message: timingNote,
    });

    await recordTelemetryComm(redis, {
      fromAgent: "leader_int",
      toAgent: "aggregator",
      message: `Leader schedule ready: current ${currentLeader ?? "unknown"}, next Jito ${nextJitoLeaderIdentity} in ${nextJitoLeaderSlotsAway} slots.`,
    });
  }

  console.log(
    `Leader Agent telemetry: slot ${currentSlot}, current ${currentLeader ?? "unknown"}, next Jito ${nextJitoLeaderIdentity ?? "unknown"} (${nextJitoLeaderSlotsAway ?? "?"} slots)`,
  );
}
