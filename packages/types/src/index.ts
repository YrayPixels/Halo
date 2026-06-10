export type TransactionStatus =
  | "SUBMITTED"
  | "PROCESSED"
  | "CONFIRMED"
  | "FINALIZED"
  | "FAILED";

export interface NetworkSnapshot {
  currentSlot: bigint;
  currentLeader?: string;
  observedAt: Date;
}

export interface TrackedTransaction {
  id: string;
  signature?: string;
  bundleId?: string;
  status: TransactionStatus;
  createdAt: Date;
  processedAt?: Date;
  confirmedAt?: Date;
  finalizedAt?: Date;
  slot?: bigint;
  tipLamports?: bigint;
}
