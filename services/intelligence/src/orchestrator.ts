import { Connection } from "@solana/web3.js";
import type { Transaction } from "@halo/database";
import {
  markAgentProcessed,
  markTransactionFailed,
  saveAgentComm,
  saveAgentDecision,
  saveAgentStep,
} from "@halo/database";
import type { Redis } from "ioredis";
import { optionalEnv, publishAgentComm, publishRetryRequest, REDIS_KEYS } from "@halo/shared";
import { buildFailureContext, classifyFailure } from "./failure-classifier.js";
import { synthesizeDecision } from "./llm.js";
import { calculateDynamicTip } from "./tip-intelligence.js";
import { searcherClient } from "./jito-searcher.js";

async function recordComm(
  redis: Redis,
  options: {
    transactionId: string;
    fromAgent: string;
    toAgent: string;
    message: string;
  },
) {
  await saveAgentComm(options);
  await publishAgentComm(redis, {
    fromAgent: options.fromAgent,
    toAgent: options.toAgent,
    message: options.message,
    transactionId: options.transactionId,
    observedAt: new Date().toISOString(),
  });
}

async function recordStep(
  options: {
    transactionId: string;
    agentName: string;
    label: string;
    note: string;
    tone: "danger" | "info" | "warning" | "success";
    stepOrder: number;
  },
) {
  await saveAgentStep(options);
}

export async function runAgentPipeline(
  redis: Redis,
  transaction: Transaction,
): Promise<void> {
  const rpcUrl = optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
  const blockEngineUrl = optionalEnv("JITO_BLOCK_ENGINE_URL", "mainnet.block-engine.jito.wtf");
  const floorTip = Number(optionalEnv("JITO_MIN_TIP_LAMPORTS", optionalEnv("JITO_TIP_LAMPORTS", "0")));
  const connection = new Connection(rpcUrl, "confirmed");

  const currentSlotRaw = await redis.get(REDIS_KEYS.networkCurrentSlot);
  const currentSlot = currentSlotRaw ? BigInt(currentSlotRaw) : null;
  const currentBlockHeight = BigInt(await connection.getBlockHeight("confirmed"));

  const context = buildFailureContext(transaction, currentSlot, currentBlockHeight);
  const classification = classifyFailure(context);

  if (!transaction.failureClass) {
    await markTransactionFailed(
      transaction.id,
      classification.failureClass,
      classification.failureReason,
      transaction.errorMessage ?? undefined,
    );
  }

  await recordComm(redis, {
    transactionId: transaction.id,
    fromAgent: "orchestrator",
    toAgent: "stream_ext",
    message: `Analyzing failed bundle ${transaction.bundleId ?? transaction.id.slice(0, 8)} at slot ${currentSlotRaw ?? "unknown"}.`,
  });

  const failureNote = `${classification.failureClass}: ${classification.failureReason}`;
  await recordStep({
    transactionId: transaction.id,
    agentName: "failure",
    label: "Failure Agent",
    note: failureNote,
    tone: "danger",
    stepOrder: 1,
  });

  await recordComm(redis, {
    transactionId: transaction.id,
    fromAgent: "bundle_int",
    toAgent: "failure",
    message: failureNote,
  });

  const tipRecommendation = await calculateDynamicTip(connection, {
    failureClass: classification.failureClass,
    currentTip: transaction.tipLamports,
    floorTip,
  });
  await Promise.all([
    redis.set(REDIS_KEYS.networkMedianPriorityFee, String(tipRecommendation.networkMedianFee)),
    redis.set(REDIS_KEYS.tipAccountActivity, String(tipRecommendation.recentTipActivity)),
  ]);

  const tipNote = `+${Math.round(((tipRecommendation.tipLamports / Number(transaction.tipLamports ?? floorTip)) - 1) * 100)}% tip → ${tipRecommendation.tipLamports.toLocaleString()} lamports`;
  await recordStep({
    transactionId: transaction.id,
    agentName: "tip",
    label: "Tip Agent",
    note: tipNote,
    tone: "info",
    stepOrder: 2,
  });

  await recordComm(redis, {
    transactionId: transaction.id,
    fromAgent: "tip_int",
    toAgent: "retry",
    message: `${tipRecommendation.reasoning} Proposing ${tipRecommendation.tipLamports} lamports.`,
  });

  let leaderSlotsAway = 99;
  try {
    const searcher = searcherClient(blockEngineUrl);
    const leader = await searcher.getNextScheduledLeader();
    if (leader.ok) {
      leaderSlotsAway = leader.value.nextLeaderSlot - leader.value.currentSlot;
      await Promise.all([
        redis.set(REDIS_KEYS.nextJitoLeaderSlot, String(leader.value.nextLeaderSlot)),
        redis.set(REDIS_KEYS.nextJitoLeaderIdentity, leader.value.nextLeaderIdentity),
        redis.set(REDIS_KEYS.nextJitoLeaderSlotsAway, String(leaderSlotsAway)),
        redis.set(REDIS_KEYS.recommendedSubmitSlot, String(leader.value.nextLeaderSlot)),
      ]);
    }
  } catch (error) {
    console.warn("Failed to fetch Jito leader schedule:", error);
  }

  const timingNote =
    leaderSlotsAway <= 2
      ? `Jito leader in ${leaderSlotsAway} slots — submit now`
      : `Next Jito leader in ${leaderSlotsAway} slots — hold retry`;

  await recordStep({
    transactionId: transaction.id,
    agentName: "timing",
    label: "Timing Agent",
    note: timingNote,
    tone: leaderSlotsAway <= 2 ? "success" : "warning",
    stepOrder: 3,
  });

  await recordComm(redis, {
    transactionId: transaction.id,
    fromAgent: "leader_int",
    toAgent: "timing",
    message: timingNote,
  });

  const finalDecision = await synthesizeDecision({
    failureClass: classification.failureClass,
    failureReason: classification.failureReason,
    currentTipLamports: Number(transaction.tipLamports ?? floorTip),
    recommendedTipLamports: tipRecommendation.tipLamports,
    leaderSlotsAway,
    attempt: transaction.attempt,
    maxAttempts: transaction.maxAttempts,
    failureAgentNote: failureNote,
    tipAgentNote: tipRecommendation.reasoning,
    timingAgentNote: timingNote,
  });

  await recordComm(redis, {
    transactionId: transaction.id,
    fromAgent: "aggregator",
    toAgent: "halo",
    message: finalDecision.reasoning,
  });

  const retryNote = finalDecision.shouldRetry
    ? `action=${finalDecision.action}, tip=${finalDecision.tipLamports}`
    : "abort — no retry";

  await recordStep({
    transactionId: transaction.id,
    agentName: "retry",
    label: "Retry Executor",
    note: retryNote,
    tone: finalDecision.shouldRetry ? "success" : "warning",
    stepOrder: 4,
  });

  const decision = await saveAgentDecision({
    transactionId: transaction.id,
    failureClass: classification.failureClass,
    reasoning: finalDecision.reasoning,
    action: finalDecision.action,
    recommendedTipLamports: BigInt(finalDecision.tipLamports),
    shouldRetry: finalDecision.shouldRetry,
    leaderSlotsAway,
  });

  await redis.set(REDIS_KEYS.recommendedTip, String(finalDecision.tipLamports));

  if (finalDecision.shouldRetry) {
    await publishRetryRequest(redis, {
      parentTransactionId: transaction.id,
      action: finalDecision.action,
      tipLamports: String(finalDecision.tipLamports),
      waitForLeader: String(finalDecision.waitForLeader),
      decisionId: decision.id,
      observedAt: new Date().toISOString(),
    });
  }

  await markAgentProcessed(transaction.id);
  console.log(`Agent pipeline complete for ${transaction.id}: ${finalDecision.action}`);
}
