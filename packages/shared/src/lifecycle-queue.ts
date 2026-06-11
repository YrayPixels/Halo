import type { Redis } from "ioredis";
import type { TransactionStatus } from "@halo/types";

export const LIFECYCLE_QUEUE_KEY = "halo:lifecycle_queue";

/** Signatures stay in the queue until FINALIZED or FAILED. */
export type QueuedLifecycleStatus = Extract<TransactionStatus, "SUBMITTED" | "PROCESSED" | "CONFIRMED">;

export interface LifecycleQueueEntry {
  signature: string;
  status: QueuedLifecycleStatus;
  slot?: string;
  enqueuedAt: string;
  updatedAt: string;
}

const QUEUE_STATUS_RANK: Record<QueuedLifecycleStatus, number> = {
  SUBMITTED: 0,
  PROCESSED: 1,
  CONFIRMED: 2,
};

function canAdvanceQueueStatus(from: QueuedLifecycleStatus, to: QueuedLifecycleStatus): boolean {
  return QUEUE_STATUS_RANK[to] > QUEUE_STATUS_RANK[from];
}

function parseEntry(signature: string, raw: string): LifecycleQueueEntry | null {
  try {
    const parsed = JSON.parse(raw) as LifecycleQueueEntry;
    if (!parsed.status || !parsed.enqueuedAt) {
      return null;
    }

    return {
      signature,
      status: parsed.status,
      slot: parsed.slot,
      enqueuedAt: parsed.enqueuedAt,
      updatedAt: parsed.updatedAt ?? parsed.enqueuedAt,
    };
  } catch {
    return null;
  }
}

export async function getLifecycleEntry(
  redis: Redis,
  signature: string,
): Promise<LifecycleQueueEntry | null> {
  const raw = await redis.hget(LIFECYCLE_QUEUE_KEY, signature);
  if (!raw) {
    return null;
  }

  return parseEntry(signature, raw);
}

export async function listLifecycleQueue(redis: Redis): Promise<LifecycleQueueEntry[]> {
  const rows = await redis.hgetall(LIFECYCLE_QUEUE_KEY);
  const entries: LifecycleQueueEntry[] = [];

  for (const [signature, raw] of Object.entries(rows)) {
    const entry = parseEntry(signature, raw);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries.sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
}

export async function enqueueLifecycleSignature(
  redis: Redis,
  signature: string,
  status: QueuedLifecycleStatus,
  slot?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getLifecycleEntry(redis, signature);
  const nextStatus =
    existing && !canAdvanceQueueStatus(existing.status, status) ? existing.status : status;

  const entry: LifecycleQueueEntry = {
    signature,
    status: nextStatus,
    slot: slot ?? existing?.slot,
    enqueuedAt: existing?.enqueuedAt ?? now,
    updatedAt: now,
  };

  await redis.hset(LIFECYCLE_QUEUE_KEY, signature, JSON.stringify(entry));
}

export async function updateLifecycleQueueStatus(
  redis: Redis,
  signature: string,
  status: QueuedLifecycleStatus,
  slot?: string,
): Promise<void> {
  const existing = await getLifecycleEntry(redis, signature);
  if (!existing) {
    await enqueueLifecycleSignature(redis, signature, status, slot);
    return;
  }

  if (!canAdvanceQueueStatus(existing.status, status)) {
    return;
  }

  const now = new Date().toISOString();
  const entry: LifecycleQueueEntry = {
    ...existing,
    status,
    slot: slot ?? existing.slot,
    updatedAt: now,
  };

  await redis.hset(LIFECYCLE_QUEUE_KEY, signature, JSON.stringify(entry));
}

export async function ejectLifecycleSignature(redis: Redis, signature: string): Promise<void> {
  await redis.hdel(LIFECYCLE_QUEUE_KEY, signature);
}
