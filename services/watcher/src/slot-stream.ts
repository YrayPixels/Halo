import type { Redis } from "ioredis";
import {
  CommitmentLevel,
  createYellowstoneClient,
  REDIS_KEYS,
  writeSubscribeRequest,
  type ClientDuplexStream,
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
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.PROCESSED,
    ...overrides,
  };
}

export async function startSlotStream(
  endpoint: string,
  token: string | undefined,
  redis: Redis,
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

    if (!update.slot) {
      return;
    }

    const slot = update.slot.slot;
    console.log(`Slot: ${slot}`);

    void redis.set(REDIS_KEYS.networkCurrentSlot, slot).catch((error: unknown) => {
      console.error(`Failed to write ${REDIS_KEYS.networkCurrentSlot}:`, error);
    });
  });

  stream.on("error", (error: Error) => {
    console.error("Yellowstone stream error:", error);
  });

  stream.on("close", () => {
    console.log("Yellowstone stream closed");
  });

  return () => {
    stream.destroy();
  };
}
