import { prisma } from "@halo/database";
import type { TransactionStatus } from "@halo/types";

const ACTIVE_STATUSES: TransactionStatus[] = ["SUBMITTED", "PROCESSED", "CONFIRMED"];

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

export async function advanceTransactionStatus(
  signature: string,
  nextStatus: TransactionStatus,
  options: { slot?: bigint; failed?: boolean } = {},
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

export async function pollSignatureStatuses(rpcUrl: string, watchlist: Map<string, TransactionStatus>): Promise<void> {
  if (watchlist.size === 0) {
    return;
  }

  const { Connection } = await import("@solana/web3.js");
  const connection = new Connection(rpcUrl, "confirmed");
  const signatures = [...watchlist.keys()];

  const response = await connection.getSignatureStatuses(signatures, {
    searchTransactionHistory: true,
  });

  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index]!;
    const status = response.value[index];

    if (!status) {
      continue;
    }

    if (status.err) {
      await advanceTransactionStatus(signature, "FAILED");
      continue;
    }

    const confirmationStatus = status.confirmationStatus;

    if (confirmationStatus === "finalized") {
      await advanceTransactionStatus(signature, "FINALIZED", {
        slot: status.slot !== null && status.slot !== undefined ? BigInt(status.slot) : undefined,
      });
      continue;
    }

    if (confirmationStatus === "confirmed") {
      await advanceTransactionStatus(signature, "CONFIRMED", {
        slot: status.slot !== null && status.slot !== undefined ? BigInt(status.slot) : undefined,
      });
      continue;
    }

    if (confirmationStatus === "processed") {
      await advanceTransactionStatus(signature, "PROCESSED", {
        slot: status.slot !== null && status.slot !== undefined ? BigInt(status.slot) : undefined,
      });
    }
  }
}
