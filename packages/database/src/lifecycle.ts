import type { AgentAction, AgentTone, FailureClass, TransactionStatus } from "@halo/types";
import { prisma } from "./client.js";

const ACTIVE_STATUSES: TransactionStatus[] = ["SUBMITTED", "PROCESSED", "CONFIRMED"];

const STATUS_RANK: Record<TransactionStatus, number> = {
  SUBMITTED: 0,
  PROCESSED: 1,
  CONFIRMED: 2,
  FINALIZED: 3,
  FAILED: 4,
};

function canAdvance(from: TransactionStatus, to: TransactionStatus): boolean {
  if (to === "FAILED") {
    return from !== "FINALIZED";
  }

  return STATUS_RANK[to] > STATUS_RANK[from];
}

export async function loadTrackedSignatures(): Promise<Map<string, TransactionStatus>> {
  const rows = await prisma.transaction.findMany({
    where: {
      signature: { not: null },
      status: { in: ACTIVE_STATUSES },
    },
    select: {
      signature: true,
      status: true,
    },
  });

  const watchlist = new Map<string, TransactionStatus>();

  for (const row of rows) {
    if (row.signature) {
      watchlist.set(row.signature, row.status as TransactionStatus);
    }
  }

  return watchlist;
}

export async function advanceTransactionStatus(
  signature: string,
  nextStatus: TransactionStatus,
  options: { slot?: bigint; errorMessage?: string } = {},
): Promise<boolean> {
  const existing = await prisma.transaction.findFirst({
    where: { signature },
  });

  if (!existing) {
    return false;
  }

  const currentStatus = existing.status as TransactionStatus;

  if (!canAdvance(currentStatus, nextStatus)) {
    return false;
  }

  const now = new Date();

  await prisma.transaction.update({
    where: { id: existing.id },
    data: {
      status: nextStatus,
      slot: options.slot ?? existing.slot,
      errorMessage: nextStatus === "FAILED" ? options.errorMessage ?? existing.errorMessage : existing.errorMessage,
      processedAt:
        nextStatus === "PROCESSED" || nextStatus === "CONFIRMED" || nextStatus === "FINALIZED"
          ? (existing.processedAt ?? now)
          : existing.processedAt,
      confirmedAt:
        nextStatus === "CONFIRMED" || nextStatus === "FINALIZED"
          ? (existing.confirmedAt ?? now)
          : existing.confirmedAt,
      finalizedAt: nextStatus === "FINALIZED" ? now : existing.finalizedAt,
    },
  });

  console.log(`${signature.slice(0, 12)}... ${currentStatus} -> ${nextStatus}`);
  return true;
}

export async function markTransactionFailed(
  transactionId: string,
  failureClass: FailureClass,
  failureReason: string,
  errorMessage?: string,
): Promise<void> {
  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      status: "FAILED",
      failureClass,
      failureReason,
      errorMessage,
    },
  });
}

export async function loadUnprocessedFailures() {
  return prisma.transaction.findMany({
    where: {
      status: "FAILED",
      agentProcessed: false,
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
}

export async function loadStaleSubmissions(staleAfterMs: number) {
  const cutoff = new Date(Date.now() - staleAfterMs);

  return prisma.transaction.findMany({
    where: {
      status: "SUBMITTED",
      agentProcessed: false,
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
}

export async function saveAgentStep(options: {
  transactionId: string;
  agentName: string;
  label: string;
  note: string;
  tone: AgentTone;
  stepOrder: number;
}) {
  return prisma.agentStep.create({
    data: options,
  });
}

export async function saveAgentComm(options: {
  transactionId?: string;
  fromAgent: string;
  toAgent: string;
  message: string;
}) {
  return prisma.agentComm.create({
    data: options,
  });
}

export async function saveAgentDecision(options: {
  transactionId: string;
  failureClass: FailureClass;
  reasoning: string;
  action: AgentAction;
  recommendedTipLamports: bigint;
  shouldRetry: boolean;
  leaderSlotsAway?: number;
}) {
  return prisma.agentDecision.create({
    data: options,
  });
}

export async function markAgentProcessed(transactionId: string): Promise<void> {
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { agentProcessed: true },
  });
}

export async function getLatestAgentFlow(transactionId?: string) {
  const steps = await prisma.agentStep.findMany({
    where: transactionId ? { transactionId } : undefined,
    orderBy: [{ createdAt: "desc" }, { stepOrder: "asc" }],
    take: transactionId ? 20 : 8,
  });

  if (transactionId) {
    return steps.sort((a, b) => a.stepOrder - b.stepOrder);
  }

  const latestTransactionId = steps[0]?.transactionId;
  if (!latestTransactionId) {
    return [];
  }

  return prisma.agentStep.findMany({
    where: { transactionId: latestTransactionId },
    orderBy: { stepOrder: "asc" },
  });
}

export async function getRecentAgentComms(limit = 20) {
  return prisma.agentComm.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getLatestAgentDecision() {
  return prisma.agentDecision.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      transaction: {
        select: {
          id: true,
          bundleId: true,
          signature: true,
          failureClass: true,
          tipLamports: true,
        },
      },
    },
  });
}

export async function getTransactionById(id: string) {
  return prisma.transaction.findUnique({ where: { id } });
}
