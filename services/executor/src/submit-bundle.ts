import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { prisma } from "@halo/database";
import {
  Bundle,
  searcherClient,
  unwrapBundle,
  type SearcherClient,
} from "./jito-client.js";

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
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const leader = await searcher.getNextScheduledLeader();
    if (!leader.ok) {
      throw leader.error;
    }

    const slotsAway = leader.value.nextLeaderSlot - leader.value.currentSlot;
    console.log(`Next Jito leader in ${slotsAway} slots`);

    if (slotsAway <= maxSlotsAway) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.warn("Timed out waiting for nearby Jito leader; submitting anyway");
}

export async function submitTransferBundle(options: {
  rpcUrl: string;
  blockEngineUrl: string;
  payer: Keypair;
  destination: PublicKey;
  transferLamports: number;
  tipLamports: number;
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

  await waitForNearbyLeader(searcher);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  console.log(`Blockhash: ${blockhash} (valid until ${lastValidBlockHeight})`);

  const transferTx = buildTransferTransaction(
    options.payer,
    options.destination,
    options.transferLamports,
    blockhash,
  );

  const signature = bs58.encode(transferTx.signatures[0]!);
  console.log(`Transfer signature: ${signature}`);

  let bundle = new Bundle([], BUNDLE_TRANSACTION_LIMIT);
  bundle = unwrapBundle(bundle.addTransactions(transferTx));
  bundle = unwrapBundle(
    bundle.addTipTx(options.payer, options.tipLamports, tipAccount, blockhash),
  );

  const response = await searcher.sendBundle(bundle);
  if (!response.ok) {
    throw response.error;
  }

  const bundleId = response.value;
  console.log(`Bundle: ${bundleId}`);

  await prisma.transaction.create({
    data: {
      status: "SUBMITTED",
      bundleId,
      signature,
      tipLamports: BigInt(options.tipLamports),
    },
  });

  return bundleId;
}
