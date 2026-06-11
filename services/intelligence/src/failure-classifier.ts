import type { FailureClass } from "@halo/types";
import type { Transaction } from "@halo/database";

export interface FailureContext {
  currentSlot: bigint | null;
  currentBlockHeight: bigint | null;
  submittedSlot: bigint | null;
  lastValidBlockHeight: bigint | null;
  ageMs: number;
  errorMessage: string | null;
  hadProcessed: boolean;
  tipLamports: bigint | null;
}

export function buildFailureContext(
  transaction: Transaction,
  currentSlot: bigint | null,
  currentBlockHeight: bigint | null = null,
): FailureContext {
  const ageMs = Date.now() - transaction.createdAt.getTime();

  return {
    currentSlot,
    currentBlockHeight,
    submittedSlot: transaction.submittedSlot,
    lastValidBlockHeight: transaction.lastValidBlockHeight,
    ageMs,
    errorMessage: transaction.errorMessage,
    hadProcessed: Boolean(transaction.processedAt),
    tipLamports: transaction.tipLamports,
  };
}

export function classifyFailure(context: FailureContext): {
  failureClass: FailureClass;
  failureReason: string;
} {
  const error = (context.errorMessage ?? "").toLowerCase();

  if (
    error.includes("blockhashnotfound") ||
    error.includes("blockhash not found") ||
    error.includes("expired") ||
    (context.lastValidBlockHeight !== null &&
      context.currentBlockHeight !== null &&
      context.currentBlockHeight > context.lastValidBlockHeight)
  ) {
    return {
      failureClass: "BLOCKHASH_EXPIRED",
      failureReason: "Transaction blockhash expired before the bundle reached a producing Jito leader.",
    };
  }

  if (error.includes("computebudgetexceeded") || error.includes("compute budget")) {
    return {
      failureClass: "COMPUTE_EXCEEDED",
      failureReason: "Transaction exceeded its compute budget during execution.",
    };
  }

  if (
    error.includes("insufficient") ||
    error.includes("fee") ||
    error.includes("prioritization")
  ) {
    return {
      failureClass: "TIP_TOO_LOW",
      failureReason: "Bundle tip or priority fee was too low to win the Jito auction.",
    };
  }

  if (error.includes("bundle") || error.includes("rejected") || error.includes("dropped")) {
    return {
      failureClass: "BUNDLE_REJECTED",
      failureReason: "Jito block engine rejected or dropped the bundle before inclusion.",
    };
  }

  if (!context.hadProcessed && context.ageMs > 30_000) {
    return {
      failureClass: "LEADER_SKIPPED",
      failureReason:
        "No processed status observed — likely missed the Jito leader window or leader skipped the slot.",
    };
  }

  if (context.ageMs > 45_000 && !context.hadProcessed) {
    return {
      failureClass: "BLOCKHASH_EXPIRED",
      failureReason: "Bundle aged out without landing — blockhash likely expired during leader wait.",
    };
  }

  return {
    failureClass: "UNKNOWN",
    failureReason: "Failure cause unclear from lifecycle signals; treating as timing or network issue.",
  };
}
