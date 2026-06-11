export type TransactionStatus =
  | "SUBMITTED"
  | "PROCESSED"
  | "CONFIRMED"
  | "FINALIZED"
  | "FAILED";

export type FailureClass =
  | "BLOCKHASH_EXPIRED"
  | "TIP_TOO_LOW"
  | "COMPUTE_EXCEEDED"
  | "BUNDLE_REJECTED"
  | "LEADER_SKIPPED"
  | "UNKNOWN";

export type AgentAction =
  | "REFRESH_BLOCKHASH_AND_RETRY"
  | "INCREASE_TIP_AND_RETRY"
  | "WAIT_FOR_LEADER_AND_RETRY"
  | "ABORT";

export type AgentTone = "danger" | "info" | "warning" | "success";

export type AgentNodeTone = "router" | "raw" | "signal" | "engine" | "inference";

export interface NetworkSnapshot {
  currentSlot: bigint;
  currentLeader?: string;
  nextJitoLeaderSlot?: bigint;
  nextJitoLeaderIdentity?: string;
  nextJitoLeaderSlotsAway?: number;
  recommendedSubmitSlot?: bigint;
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
  processedSlot?: bigint;
  confirmedSlot?: bigint;
  finalizedSlot?: bigint;
  processedViaStream?: boolean;
  confirmedViaStream?: boolean;
  finalizedViaStream?: boolean;
  submittedToProcessedMs?: number;
  processedToConfirmedMs?: number;
  confirmedToFinalizedMs?: number;
  submittedToFinalizedMs?: number;
  tipLamports?: bigint;
  tipSource?: string;
  networkMedianFee?: bigint;
  tipAccountActivity?: bigint;
  failureClass?: FailureClass;
  failureReason?: string;
  bundleFailureCode?: string;
  bundleFailureSource?: string;
  attempt?: number;
  maxAttempts?: number;
  parentTransactionId?: string;
  lastValidBlockHeight?: bigint;
  submittedSlot?: bigint;
  targetLeaderSlot?: bigint;
  targetLeaderIdentity?: string;
  leaderSlotsAway?: number;
}

export interface AgentFlowStep {
  id: string;
  agentName: string;
  label: string;
  note: string;
  tone: AgentTone;
  stepOrder: number;
  transactionId?: string;
  createdAt: string;
}

export interface AgentCommMessage {
  id: string;
  fromAgent: string;
  toAgent: string;
  message: string;
  transactionId?: string;
  createdAt: string;
}

export interface AgentDecisionRecord {
  id: string;
  transactionId: string;
  failureClass: FailureClass;
  reasoning: string;
  action: AgentAction;
  recommendedTipLamports: string;
  shouldRetry: boolean;
  leaderSlotsAway?: number;
  createdAt: string;
  steps: AgentFlowStep[];
}

export interface RetryRequest {
  parentTransactionId: string;
  action: AgentAction;
  tipLamports: number;
  waitForLeader: boolean;
  decisionId: string;
}
