import bs58 from "bs58";
import {
  CommitmentLevel,
  createYellowstoneClient,
  writeSubscribeRequest,
  type SubscribeRequest,
  type SubscribeUpdate,
} from "@halo/shared";
import type { TransactionStatus } from "@halo/types";
import { advanceTransactionStatus } from "./lifecycle.js";

function createSubscribeRequest(overrides: Partial<SubscribeRequest> = {}): SubscribeRequest {
  return {
    accounts: {},
    slots: {},
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

export async function startLifecycleStream(
  endpoint: string,
  token: string | undefined,
  getWatchlist: () => Map<string, TransactionStatus>,
): Promise<() => void> {
  const client = createYellowstoneClient(endpoint, token);
  await client.connect();

  const stream = await client.subscribe(createSubscribeRequest());

  stream.on("data", (update: SubscribeUpdate) => {
    if (update.ping) {
      void writeSubscribeRequest(stream, createSubscribeRequest({ ping: { id: 1 } })).catch(
        (error: unknown) => {
          console.error("Failed to reply to Yellowstone ping:", error);
        },
      );
      return;
    }

    const watchlist = getWatchlist();

    if (update.transaction?.transaction?.signature) {
      const signature = decodeSignature(update.transaction.transaction.signature);

      if (watchlist.has(signature)) {
        void advanceTransactionStatus(signature, "PROCESSED", {
          slot: BigInt(update.transaction.slot),
        });
      }
    }

    if (update.transactionStatus?.signature) {
      const signature = decodeSignature(update.transactionStatus.signature);

      if (!watchlist.has(signature)) {
        return;
      }

      if (update.transactionStatus.err) {
        void advanceTransactionStatus(signature, "FAILED");
        return;
      }

      void advanceTransactionStatus(signature, "PROCESSED", {
        slot: BigInt(update.transactionStatus.slot),
      });
    }
  });

  stream.on("error", (error: Error) => {
    console.error("Tracker Yellowstone stream error:", error);
  });

  stream.on("close", () => {
    console.log("Tracker Yellowstone stream closed");
  });

  return () => {
    stream.destroy();
  };
}
