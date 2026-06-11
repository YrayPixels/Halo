import type { Redis } from "ioredis";
import { loadStaleSubmissions, loadUnprocessedFailures, markTransactionFailed } from "@halo/database";
import { REDIS_KEYS } from "@halo/shared";
import { buildFailureContext, classifyFailure } from "./failure-classifier.js";
import { runAgentPipeline } from "./orchestrator.js";

const STALE_SUBMISSION_MS = 35_000;

export async function processPendingFailures(redis: Redis): Promise<void> {
  const staleSubmissions = await loadStaleSubmissions(STALE_SUBMISSION_MS);
  const currentSlotRaw = await redis.get(REDIS_KEYS.networkCurrentSlot);
  const currentSlot = currentSlotRaw ? BigInt(currentSlotRaw) : null;

  for (const transaction of staleSubmissions) {
    const context = buildFailureContext(transaction, currentSlot);
    const classification = classifyFailure({
      ...context,
      ageMs: Date.now() - transaction.createdAt.getTime(),
      hadProcessed: false,
    });

    await markTransactionFailed(
      transaction.id,
      classification.failureClass,
      classification.failureReason,
      "No lifecycle progression observed before timeout",
    );

    console.log(`Marked stale submission ${transaction.id} as ${classification.failureClass}`);
  }

  const failures = await loadUnprocessedFailures();

  for (const transaction of failures) {
    try {
      await runAgentPipeline(redis, transaction);
    } catch (error) {
      console.error(`Agent pipeline failed for ${transaction.id}:`, error);
    }
  }
}
