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
import { optionalEnv, REDIS_KEYS } from "@halo/shared";
import {
  Bundle,
  searcherClient,
  unwrapBundle,
  type SearcherClient,
} from "./jito-client.js";
import { calculateDynamicTip } from "./tip-intelligence.js";

const BUNDLE_TRANSACTION_LIMIT = 5;

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
  forceWait = false,
): Promise<number> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const leader = await searcher.getNextScheduledLeader();
    if (!leader.ok) {
      throw leader.error;
    }

    const slotsAway = leader.value.nextLeaderSlot - leader.value.currentSlot;
    console.log(`Next Jito leader in ${slotsAway} slots`);

    if (!forceWait || slotsAway <= maxSlotsAway) {
      if (slotsAway <= maxSlotsAway) {
        return slotsAway;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.warn("Timed out waiting for nearby Jito leader; submitting anyway");
  return 99;
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
): Promise<number> {
  if (explicitTip !== undefined) {
    return explicitTip;
  }

  const recommended = await redis?.get(REDIS_KEYS.recommendedTip);
  if (recommended) {
    return Number(recommended);
  }

  const floorTip = Number(optionalEnv("JITO_TIP_LAMPORTS", "10000"));
  const dynamic = await calculateDynamicTip(connection, { floorTip });
  return dynamic.tipLamports;
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
  waitForLeader?: boolean;
  injectExpiredBlockhash?: boolean;
}): Promise<string> {
  const connection = new Connection(options.rpcUrl, "confirmed");
  const searcher = searcherClient(options.blockEngineUrl, options.payer);

  const tipAccounts = await searcher.getTipAccounts();
  if (!tipAccounts.ok) {
    throw tipAccounts.error;
  }

  const tipAccount = new PublicKey(tipAccounts.value[0]!);
  console.log(`Tip account: ${tipAccount.toBase58()}`);

  const balance = await connection.getBalance(options.payer.publicKey);
  console.log(`Payer balance: ${balance} lamports`);

  const tipLamports = await resolveTipLamports(connection, options.redis, options.tipLamports);
  console.log(`Using tip: ${tipLamports} lamports`);

  await waitForNearbyLeader(searcher, 2, 60_000, options.waitForLeader ?? false);

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

  let bundle = new Bundle([], BUNDLE_TRANSACTION_LIMIT);
  bundle = unwrapBundle(bundle.addTransactions(transferTx));
  bundle = unwrapBundle(
    bundle.addTipTx(options.payer, tipLamports, tipAccount, activeBlockhash),
  );

  const response = await searcher.sendBundle(bundle);
  if (!response.ok) {
    throw response.error;
  }

  const bundleId = response.value;
  console.log(`Bundle: ${bundleId}`);

  const currentSlotRaw = await options.redis?.get(REDIS_KEYS.networkCurrentSlot);

  await prisma.transaction.create({
    data: {
      status: "SUBMITTED",
      bundleId,
      signature,
      tipLamports: BigInt(tipLamports),
      attempt: options.attempt ?? 1,
      parentTransactionId: options.parentTransactionId,
      lastValidBlockHeight: BigInt(activeLastValid),
      submittedSlot: currentSlotRaw ? BigInt(currentSlotRaw) : undefined,
    },
  });

  return bundleId;
}
