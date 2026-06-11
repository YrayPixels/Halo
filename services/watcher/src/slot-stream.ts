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

function createSubscribeRequest(overrides: Partial<SubscribeRequest> = {}): SubscribeRequest {
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
    commitment: CommitmentLevel.PROCESSED,
    ...overrides,
  };
}

function decodeSignature(signature: Uint8Array): string {
  return bs58.encode(signature);
}

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

  const stream = await client.subscribe(createSubscribeRequest());

  const enqueueTrackedTransaction = (signature: string, slot: string, failed: boolean) => {
    if (!watchlist.has(signature)) {
      return;
    }

    void publishTxEvent(redis, {
      signature,
      slot,
      status: failed ? "FAILED" : "PROCESSED",
      observedAt: new Date().toISOString(),
    }).catch((error: unknown) => {
      console.error(`Failed to publish tx event for ${signature}:`, error);
    });
  };

  stream.on("data", (update: SubscribeUpdate) => {
    if (update.ping) {
      void writeSubscribeRequest(stream, createSubscribeRequest({ ping: { id: 1 } })).catch(
        (error: unknown) => {
          console.error("Failed to reply to Yellowstone ping:", error);
        },
      );
      return;
    }

    if (update.slot) {
      const slot = update.slot.slot;
      console.log(`Slot: ${slot}`);

      void redis.set(REDIS_KEYS.networkCurrentSlot, slot).catch((error: unknown) => {
        console.error(`Failed to write ${REDIS_KEYS.networkCurrentSlot}:`, error);
      });
      return;
    }

    if (update.transaction?.transaction?.signature) {
      const signature = decodeSignature(update.transaction.transaction.signature);
      enqueueTrackedTransaction(signature, update.transaction.slot, false);
      return;
    }

    if (update.transactionStatus?.signature) {
      const signature = decodeSignature(update.transactionStatus.signature);
      enqueueTrackedTransaction(
        signature,
        update.transactionStatus.slot,
        Boolean(update.transactionStatus.err),
      );
    }
  });

  stream.on("error", (error: Error) => {
    console.error("Yellowstone stream error:", error);
  });

  stream.on("close", () => {
    console.log("Yellowstone stream closed");
  });

  return () => {
    clearInterval(watchlistInterval);
    stream.destroy();
  };
}
