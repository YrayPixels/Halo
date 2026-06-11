import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { Redis } from "ioredis";
import { prisma } from "@halo/database";
import { enqueueLifecycleSignature, optionalEnv, REDIS_KEYS } from "@halo/shared";
import type { FailureClass } from "@halo/types";
import {
  Bundle,
  searcherClient,
  unwrapBundle,
  type SearcherClient,
} from "./jito-client.js";
import { calculateDynamicTip, type TipRecommendation } from "./tip-intelligence.js";

const BUNDLE_TRANSACTION_LIMIT = 5;

interface LeaderWindow {
  currentSlot: number;
  nextLeaderSlot: number;
  nextLeaderIdentity: string;
  slotsAway: number;
}

function buildTransferTransaction(
  payer: Keypair,
  destination: PublicKey,
  lamports: number,
  recentBlockhash: string,
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: destination,
        lamports,
      }),
    ],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);

  return transaction;
}

async function waitForNearbyLeader(
  searcher: SearcherClient,
  maxSlotsAway = 2,
  timeoutMs = 60_000,
): Promise<LeaderWindow> {
  const startedAt = Date.now();
  let lastLeader: LeaderWindow | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const leader = await searcher.getNextScheduledLeader();
    if (!leader.ok) {
      throw leader.error;
    }

    const slotsAway = leader.value.nextLeaderSlot - leader.value.currentSlot;
    lastLeader = {
      currentSlot: leader.value.currentSlot,
      nextLeaderSlot: leader.value.nextLeaderSlot,
      nextLeaderIdentity: leader.value.nextLeaderIdentity,
      slotsAway,
    };
    console.log(`Next Jito leader in ${slotsAway} slots`);

    if (slotsAway <= maxSlotsAway) {
      return lastLeader;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `Timed out waiting for nearby Jito leader${
      lastLeader ? `; next leader was ${lastLeader.slotsAway} slots away` : ""
    }`,
  );
}

async function waitForBlockhashExpiry(
  connection: Connection,
  lastValidBlockHeight: number,
): Promise<void> {
  console.warn(
    `[FAULT INJECTION] Waiting for blockhash to expire (lastValidBlockHeight=${lastValidBlockHeight})`,
  );

  while (true) {
    const currentHeight = await connection.getBlockHeight("confirmed");
    if (currentHeight > lastValidBlockHeight) {
      console.warn(`[FAULT INJECTION] Blockhash expired at height ${currentHeight}`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function resolveTipLamports(
  connection: Connection,
  redis: Redis | undefined,
  explicitTip: number | undefined,
): Promise<TipRecommendation> {
  if (explicitTip !== undefined) {
    return {
      tipLamports: explicitTip,
      source: "explicit_retry_request",
      networkMedianFee: 0,
      recentTipActivity: 0,
    };
  }

  const recommended = await redis?.get(REDIS_KEYS.recommendedTip);
  if (recommended) {
    return {
      tipLamports: Number(recommended),
      source: "agent_recommended_tip",
      networkMedianFee: 0,
      recentTipActivity: 0,
    };
  }

  const floorTip = Number(optionalEnv("JITO_MIN_TIP_LAMPORTS", optionalEnv("JITO_TIP_LAMPORTS", "0")));
  return calculateDynamicTip(connection, { floorTip });
}

function classifyBundleFailure(message: string): FailureClass {
  const error = message.toLowerCase();

  if (error.includes("blockhash") || error.includes("expired")) {
    return "BLOCKHASH_EXPIRED";
  }

  if (error.includes("compute")) {
    return "COMPUTE_EXCEEDED";
  }

  if (error.includes("tip") || error.includes("fee") || error.includes("auction")) {
    return "TIP_TOO_LOW";
  }

  if (error.includes("bundle") || error.includes("rejected") || error.includes("dropped")) {
    return "BUNDLE_REJECTED";
  }

  return "UNKNOWN";
}

async function recordFailedSubmission(options: {
  signature?: string;
  tip: TipRecommendation;
  attempt: number;
  maxAttempts: number;
  parentTransactionId?: string;
  lastValidBlockHeight?: number;
  submittedSlot?: string | null;
  leaderWindow?: LeaderWindow;
  error: unknown;
  source: string;
}): Promise<void> {
  const message = options.error instanceof Error ? options.error.message : String(options.error);
  const failureClass = classifyBundleFailure(message);

  await prisma.transaction.create({
    data: {
      status: "FAILED",
      signature: options.signature,
      tipLamports: BigInt(options.tip.tipLamports),
      tipSource: options.tip.source,
      networkMedianFee: BigInt(options.tip.networkMedianFee),
      tipAccountActivity: BigInt(options.tip.recentTipActivity),
      attempt: options.attempt,
      maxAttempts: options.maxAttempts,
      parentTransactionId: options.parentTransactionId,
      lastValidBlockHeight:
        options.lastValidBlockHeight !== undefined ? BigInt(options.lastValidBlockHeight) : undefined,
      submittedSlot: options.submittedSlot ? BigInt(options.submittedSlot) : undefined,
      targetLeaderSlot:
        options.leaderWindow !== undefined ? BigInt(options.leaderWindow.nextLeaderSlot) : undefined,
      targetLeaderIdentity: options.leaderWindow?.nextLeaderIdentity,
      leaderSlotsAway: options.leaderWindow?.slotsAway,
      failureClass,
      failureReason: `Submission failed before landing: ${message}`,
      errorMessage: message,
      bundleFailureCode: options.error instanceof Error ? options.error.name : "SubmissionError",
      bundleFailureSource: options.source,
    },
  });
}

export async function submitTransferBundle(options: {
  rpcUrl: string;
  blockEngineUrl: string;
  payer: Keypair;
  destination: PublicKey;
  transferLamports: number;
  tipLamports?: number;
  redis?: Redis;
  parentTransactionId?: string;
  attempt?: number;
  maxAttempts?: number;
  waitForLeader?: boolean;
  injectExpiredBlockhash?: boolean;
}): Promise<string> {
  const connection = new Connection(options.rpcUrl, "confirmed");
  const searcher = searcherClient(options.blockEngineUrl, options.payer);
  const attempt = options.attempt ?? 1;
  const maxAttempts = options.maxAttempts ?? Number(optionalEnv("MAX_BUNDLE_ATTEMPTS", "4"));

  const tipAccounts = await searcher.getTipAccounts();
  if (!tipAccounts.ok) {
    throw tipAccounts.error;
  }

  const tipAccount = new PublicKey(tipAccounts.value[0]!);
  console.log(`Tip account: ${tipAccount.toBase58()}`);

  const balance = await connection.getBalance(options.payer.publicKey);
  console.log(`Payer balance: ${balance} lamports`);

  const tip = await resolveTipLamports(connection, options.redis, options.tipLamports);
  console.log(`Using tip: ${tip.tipLamports} lamports (${tip.source})`);

  const leaderWindow = await waitForNearbyLeader(searcher, 2, 60_000);
  await Promise.all([
    options.redis?.set(REDIS_KEYS.nextJitoLeaderSlot, String(leaderWindow.nextLeaderSlot)),
    options.redis?.set(REDIS_KEYS.nextJitoLeaderIdentity, leaderWindow.nextLeaderIdentity),
    options.redis?.set(REDIS_KEYS.nextJitoLeaderSlotsAway, String(leaderWindow.slotsAway)),
    options.redis?.set(REDIS_KEYS.recommendedSubmitSlot, String(leaderWindow.nextLeaderSlot)),
    options.redis?.set(REDIS_KEYS.networkMedianPriorityFee, String(tip.networkMedianFee)),
    options.redis?.set(REDIS_KEYS.tipAccountActivity, String(tip.recentTipActivity)),
  ]);

  let { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  console.log(`Blockhash: ${blockhash} (valid until ${lastValidBlockHeight})`);

  const shouldInject =
    options.injectExpiredBlockhash ??
    optionalEnv("FAULT_INJECT_EXPIRED_BLOCKHASH", "false") === "true";

  if (shouldInject && !options.parentTransactionId) {
    await waitForBlockhashExpiry(connection, lastValidBlockHeight);
    console.warn(`[FAULT INJECTION] Submitting bundle with expired blockhash ${blockhash}`);
  }

  const activeBlockhash = blockhash;
  const activeLastValid = lastValidBlockHeight;

  const transferTx = buildTransferTransaction(
    options.payer,
    options.destination,
    options.transferLamports,
    activeBlockhash,
  );

  const signature = bs58.encode(transferTx.signatures[0]!);
  console.log(`Transfer signature: ${signature}`);

  const currentSlotRaw = await options.redis?.get(REDIS_KEYS.networkCurrentSlot);

  const simulation = await connection.simulateTransaction(transferTx, {
    replaceRecentBlockhash: false,
    sigVerify: true,
  });

  if (simulation.value.err) {
    await recordFailedSubmission({
      signature,
      tip,
      attempt,
      maxAttempts,
      parentTransactionId: options.parentTransactionId,
      lastValidBlockHeight: activeLastValid,
      submittedSlot: currentSlotRaw,
      leaderWindow,
      error: new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`),
      source: "simulation",
    });
    throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
  }

  let bundle = new Bundle([], BUNDLE_TRANSACTION_LIMIT);
  bundle = unwrapBundle(bundle.addTransactions(transferTx));
  bundle = unwrapBundle(
    bundle.addTipTx(options.payer, tip.tipLamports, tipAccount, activeBlockhash),
  );

  const response = await searcher.sendBundle(bundle);
  if (!response.ok) {
    await recordFailedSubmission({
      signature,
      tip,
      attempt,
      maxAttempts,
      parentTransactionId: options.parentTransactionId,
      lastValidBlockHeight: activeLastValid,
      submittedSlot: currentSlotRaw,
      leaderWindow,
      error: response.error,
      source: "jito_send_bundle",
    });
    throw response.error;
  }

  const bundleId = response.value;
  console.log(`Bundle: ${bundleId}`);

  await prisma.transaction.create({
    data: {
      status: "SUBMITTED",
      bundleId,
      signature,
      tipLamports: BigInt(tip.tipLamports),
      tipSource: tip.source,
      networkMedianFee: BigInt(tip.networkMedianFee),
      tipAccountActivity: BigInt(tip.recentTipActivity),
      attempt,
      maxAttempts,
      parentTransactionId: options.parentTransactionId,
      lastValidBlockHeight: BigInt(activeLastValid),
      submittedSlot: currentSlotRaw ? BigInt(currentSlotRaw) : undefined,
      targetLeaderSlot: BigInt(leaderWindow.nextLeaderSlot),
      targetLeaderIdentity: leaderWindow.nextLeaderIdentity,
      leaderSlotsAway: leaderWindow.slotsAway,
    },
  });

  if (options.redis) {
    await enqueueLifecycleSignature(options.redis, signature, "SUBMITTED", currentSlotRaw ?? undefined);
  }

  return bundleId;
}
