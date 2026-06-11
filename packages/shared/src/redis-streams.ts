import type { Redis } from "ioredis";
import type { AgentAction, TransactionStatus } from "@halo/types";

export const REDIS_STREAMS = {
  txEvents: "halo:tx_events",
  agentComms: "halo:agent_comms",
  retryRequests: "halo:retry_requests",
} as const;

export const REDIS_GROUPS = {
  tracker: "halo-tracker",
  intelligence: "halo-intelligence",
  executor: "halo-executor",
} as const;

export type StreamTxStatus = Extract<
  TransactionStatus,
  "PROCESSED" | "CONFIRMED" | "FINALIZED" | "FAILED"
>;

export interface TxLifecycleEvent {
  signature: string;
  slot: string;
  status: StreamTxStatus;
  observedAt: string;
  source: "yellowstone" | "rpc";
  errorMessage?: string;
}

export interface AgentCommEvent {
  fromAgent: string;
  toAgent: string;
  message: string;
  transactionId?: string;
  observedAt: string;
}

export interface RetryRequestEvent {
  parentTransactionId: string;
  action: AgentAction;
  tipLamports: string;
  waitForLeader: string;
  decisionId: string;
  observedAt: string;
}

export async function ensureConsumerGroup(
  redis: Redis,
  stream: string,
  group: string,
): Promise<void> {
  try {
    await redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");
  } catch (error) {
    if (error instanceof Error && error.message.includes("BUSYGROUP")) {
      return;
    }

    throw error;
  }
}

export async function publishTxEvent(redis: Redis, event: TxLifecycleEvent): Promise<void> {
  await redis.xadd(
    REDIS_STREAMS.txEvents,
    "*",
    "signature",
    event.signature,
    "slot",
    event.slot,
    "status",
    event.status,
    "observedAt",
    event.observedAt,
    "source",
    event.source,
    "errorMessage",
    event.errorMessage ?? "",
  );
}

export async function publishAgentComm(redis: Redis, event: AgentCommEvent): Promise<void> {
  await redis.xadd(
    REDIS_STREAMS.agentComms,
    "*",
    "fromAgent",
    event.fromAgent,
    "toAgent",
    event.toAgent,
    "message",
    event.message,
    "transactionId",
    event.transactionId ?? "",
    "observedAt",
    event.observedAt,
  );
}

export async function publishRetryRequest(redis: Redis, event: RetryRequestEvent): Promise<void> {
  await redis.xadd(
    REDIS_STREAMS.retryRequests,
    "*",
    "parentTransactionId",
    event.parentTransactionId,
    "action",
    event.action,
    "tipLamports",
    event.tipLamports,
    "waitForLeader",
    event.waitForLeader,
    "decisionId",
    event.decisionId,
    "observedAt",
    event.observedAt,
  );
}

function fieldsToRecord(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};

  for (let index = 0; index < fields.length; index += 2) {
    const key = fields[index];
    const value = fields[index + 1];

    if (key && value !== undefined) {
      record[key] = value;
    }
  }

  return record;
}

export function parseTxEvent(fields: string[]): TxLifecycleEvent | null {
  const record = fieldsToRecord(fields);

  if (!record.signature || !record.slot || !record.status || !record.observedAt) {
    return null;
  }

  if (
    record.status !== "PROCESSED" &&
    record.status !== "CONFIRMED" &&
    record.status !== "FINALIZED" &&
    record.status !== "FAILED"
  ) {
    return null;
  }

  return {
    signature: record.signature,
    slot: record.slot,
    status: record.status,
    observedAt: record.observedAt,
    source: record.source === "rpc" ? "rpc" : "yellowstone",
    errorMessage: record.errorMessage || undefined,
  };
}

export function parseAgentCommEvent(fields: string[]): AgentCommEvent | null {
  const record = fieldsToRecord(fields);

  if (!record.fromAgent || !record.toAgent || !record.message || !record.observedAt) {
    return null;
  }

  return {
    fromAgent: record.fromAgent,
    toAgent: record.toAgent,
    message: record.message,
    transactionId: record.transactionId || undefined,
    observedAt: record.observedAt,
  };
}

export function parseRetryRequestEvent(fields: string[]): RetryRequestEvent | null {
  const record = fieldsToRecord(fields);

  if (
    !record.parentTransactionId ||
    !record.action ||
    !record.tipLamports ||
    !record.waitForLeader ||
    !record.decisionId ||
    !record.observedAt
  ) {
    return null;
  }

  return {
    parentTransactionId: record.parentTransactionId,
    action: record.action as AgentAction,
    tipLamports: record.tipLamports,
    waitForLeader: record.waitForLeader,
    decisionId: record.decisionId,
    observedAt: record.observedAt,
  };
}
