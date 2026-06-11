import bs58 from "bs58";
import type { Redis } from "ioredis";
import { loadTrackedSignatures } from "@halo/database";
import {
  CommitmentLevel,
  createYellowstoneClient,
  publishTxEvent,
  REDIS_KEYS,
  writeSubscribeRequest,
  type SubscribeRequest,
  type SubscribeUpdate,
} from "@halo/shared";
import type { StreamTxStatus } from "@halo/shared";

function createSubscribeRequest(
  commitment: CommitmentLevel,
  overrides: Partial<SubscribeRequest> = {},
): SubscribeRequest {
  return {
    accounts: {},
    slots: {
      slots: {
        filterByCommitment: true,
      },
    },
    transactions: {
      all: {
        vote: false,
        failed: true,
        accountInclude: [],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {
      all: {
        vote: false,
        failed: true,
        accountInclude: [],
        accountExclude: [],
        accountRequired: [],
      },
    },
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment,
    ...overrides,
  };
}

function decodeSignature(signature: Uint8Array): string {
  return bs58.encode(signature);
}

function statusForCommitment(commitment: CommitmentLevel): StreamTxStatus {
  if (commitment === CommitmentLevel.CONFIRMED) {
    return "CONFIRMED";
  }

  if (commitment === CommitmentLevel.FINALIZED) {
    return "FINALIZED";
  }

  return "PROCESSED";
}

function stringifyErr(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

type BlockMetaUpdate = {
  blockMeta?: {
    slot?: string | number | bigint;
    leader?: string;
    block?: { leader?: string };
  };
  blocksMeta?: {
    slot?: string | number | bigint;
    leader?: string;
    block?: { leader?: string };
  };
};

export async function startSlotStream(
  endpoint: string,
  token: string | undefined,
  redis: Redis,
): Promise<() => void> {
  const client = createYellowstoneClient(endpoint, token);
  let watchlist = await loadTrackedSignatures();

  const refreshWatchlist = async () => {
    watchlist = await loadTrackedSignatures();
  };

  const watchlistInterval = setInterval(() => {
    void refreshWatchlist().catch((error: unknown) => {
      console.error("Failed to refresh watchlist:", error);
    });
  }, 3_000);

  await client.connect();

  const streams = await Promise.all([
    client.subscribe(createSubscribeRequest(CommitmentLevel.PROCESSED)),
    client.subscribe(createSubscribeRequest(CommitmentLevel.CONFIRMED)),
    client.subscribe(createSubscribeRequest(CommitmentLevel.FINALIZED)),
  ]);

  const enqueueTrackedTransaction = (
    signature: string,
    slot: string,
    failed: boolean,
    commitment: CommitmentLevel,
    errorMessage?: string,
  ) => {
    if (!watchlist.has(signature)) {
      return;
    }

    void publishTxEvent(redis, {
      signature,
      slot,
      status: failed ? "FAILED" : statusForCommitment(commitment),
      observedAt: new Date().toISOString(),
      source: "yellowstone",
      errorMessage,
    }).catch((error: unknown) => {
      console.error(`Failed to publish tx event for ${signature}:`, error);
    });
  };

  const handleBlockMeta = (update: SubscribeUpdate) => {
    const blockMeta = (update as BlockMetaUpdate).blockMeta ?? (update as BlockMetaUpdate).blocksMeta;
    const leader = blockMeta?.leader ?? blockMeta?.block?.leader;

    if (!blockMeta?.slot) {
      return;
    }

    if (leader) {
      void redis.set(REDIS_KEYS.networkCurrentLeader, leader).catch((error: unknown) => {
        console.error(`Failed to write ${REDIS_KEYS.networkCurrentLeader}:`, error);
      });
    }
  };

  streams.forEach((stream, index) => {
    const commitment =
      index === 0
        ? CommitmentLevel.PROCESSED
        : index === 1
          ? CommitmentLevel.CONFIRMED
          : CommitmentLevel.FINALIZED;

    stream.on("data", (update: SubscribeUpdate) => {
      if (update.ping) {
        void writeSubscribeRequest(stream, createSubscribeRequest(commitment, { ping: { id: 1 } })).catch(
          (error: unknown) => {
            console.error("Failed to reply to Yellowstone ping:", error);
          },
        );
        return;
      }

      if (commitment === CommitmentLevel.PROCESSED && update.slot) {
        const slot = update.slot.slot;
        console.log(`Slot: ${slot}`);

        void redis.set(REDIS_KEYS.networkCurrentSlot, slot).catch((error: unknown) => {
          console.error(`Failed to write ${REDIS_KEYS.networkCurrentSlot}:`, error);
        });
        return;
      }

      handleBlockMeta(update);

      if (update.transaction?.transaction?.signature) {
        const signature = decodeSignature(update.transaction.transaction.signature);
        const errorMessage = stringifyErr(update.transaction.transaction.meta?.err);
        enqueueTrackedTransaction(
          signature,
          update.transaction.slot,
          Boolean(update.transaction.transaction.meta?.err),
          commitment,
          errorMessage,
        );
        return;
      }

      if (update.transactionStatus?.signature) {
        const signature = decodeSignature(update.transactionStatus.signature);
        enqueueTrackedTransaction(
          signature,
          update.transactionStatus.slot,
          Boolean(update.transactionStatus.err),
          commitment,
          stringifyErr(update.transactionStatus.err),
        );
      }
    });

    stream.on("error", (error: Error) => {
      console.error(`Yellowstone ${statusForCommitment(commitment)} stream error:`, error);
    });

    stream.on("close", () => {
      console.log(`Yellowstone ${statusForCommitment(commitment)} stream closed`);
    });
  });

  return () => {
    clearInterval(watchlistInterval);
    for (const stream of streams) {
      stream.destroy();
    }
  };
}
