import type { Redis } from "ioredis";
import {
  CommitmentLevel,
  createYellowstoneClient,
  REDIS_KEYS,
  writeSubscribeRequest,
  type SubscribeRequest,
  type SubscribeUpdate,
} from "@halo/shared";
import type { NetworkSnapshot } from "@halo/types";

const UPDATE_QUEUE_LIMIT = 500;

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
    // Named filter required — empty {} subscribes to nothing.
    blocksMeta: {
      halo: {},
    },
    entry: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.PROCESSED,
    ...overrides,
  };
}

function serializeNetworkSnapshot(snapshot: NetworkSnapshot): Record<string, string | number> {
  const serialized: Record<string, string | number | undefined> = {
    currentSlot: snapshot.currentSlot.toString(),
    currentLeader: snapshot.currentLeader,
    blockhash: snapshot.blockhash,
    parentSlot: snapshot.parentSlot?.toString(),
    parentBlockhash: snapshot.parentBlockhash,
    executedTransactionCount: snapshot.executedTransactionCount?.toString(),
    entriesCount: snapshot.entriesCount?.toString(),
    blockHeight: snapshot.blockHeight?.toString(),
    nextJitoLeaderSlot: snapshot.nextJitoLeaderSlot?.toString(),
    nextJitoLeaderIdentity: snapshot.nextJitoLeaderIdentity,
    nextJitoLeaderSlotsAway: snapshot.nextJitoLeaderSlotsAway,
    recommendedSubmitSlot: snapshot.recommendedSubmitSlot?.toString(),
    observedAt: snapshot.observedAt.toISOString(),
  };

  return Object.fromEntries(
    Object.entries(serialized).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number>;
}

function parseOptionalBigInt(value: string | null): bigint | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readCachedLeaderSnapshot(
  redis: Redis,
  currentSlot: bigint,
): Promise<Pick<
  NetworkSnapshot,
  | "currentLeader"
  | "nextJitoLeaderSlot"
  | "nextJitoLeaderIdentity"
  | "nextJitoLeaderSlotsAway"
  | "recommendedSubmitSlot"
>> {
  const [
    cachedCurrentLeader,
    nextJitoLeaderSlotRaw,
    nextJitoLeaderIdentity,
    nextJitoLeaderSlotsAwayRaw,
    recommendedSubmitSlotRaw,
  ] = await Promise.all([
    redis.get(REDIS_KEYS.networkCurrentLeader),
    redis.get(REDIS_KEYS.nextJitoLeaderSlot),
    redis.get(REDIS_KEYS.nextJitoLeaderIdentity),
    redis.get(REDIS_KEYS.nextJitoLeaderSlotsAway),
    redis.get(REDIS_KEYS.recommendedSubmitSlot),
  ]);

  const nextJitoLeaderSlot = parseOptionalBigInt(nextJitoLeaderSlotRaw);
  const recommendedSubmitSlot = parseOptionalBigInt(recommendedSubmitSlotRaw);
  const recomputedSlotsAway =
    nextJitoLeaderSlot !== undefined ? Number(nextJitoLeaderSlot - currentSlot) : undefined;
  const nextJitoLeaderSlotsAway =
    recomputedSlotsAway !== undefined && Number.isSafeInteger(recomputedSlotsAway)
      ? recomputedSlotsAway
      : parseOptionalNumber(nextJitoLeaderSlotsAwayRaw);
  const currentLeader =
    cachedCurrentLeader ?? (nextJitoLeaderSlotsAway === 0 ? nextJitoLeaderIdentity ?? undefined : undefined);

  if (nextJitoLeaderSlotsAway !== undefined) {
    void redis.set(REDIS_KEYS.nextJitoLeaderSlotsAway, String(nextJitoLeaderSlotsAway)).catch(
      (error: unknown) => {
        console.error(`Failed to refresh ${REDIS_KEYS.nextJitoLeaderSlotsAway}:`, error);
      },
    );
  }

  return {
    currentLeader,
    nextJitoLeaderSlot,
    nextJitoLeaderIdentity: nextJitoLeaderIdentity ?? undefined,
    nextJitoLeaderSlotsAway,
    recommendedSubmitSlot,
  };
}

function logNetworkSnapshot(snapshot: NetworkSnapshot): void {
  console.log("NetworkSnapshot", serializeNetworkSnapshot(snapshot));
}

function hasProcessableUpdate(update: SubscribeUpdate): boolean {
  return Boolean(update.blockMeta);
}

export async function startSlotStream(
  endpoint: string,
  token: string | undefined,
  redis: Redis,
): Promise<() => void> {
  const client = createYellowstoneClient(endpoint, token);
  const updateQueue: SubscribeUpdate[] = [];
  let queueDraining = false;
  let droppedUpdates = 0;

  await client.connect();

  const stream = await client.subscribe(createSubscribeRequest());
  console.log("Yellowstone transaction stream disabled; tracker follows submitted Jito bundle signatures via RPC");

  const handleBlockMeta = async (update: SubscribeUpdate) => {
    const meta = update.blockMeta;
    if (!meta) {
      return;
    }

    const currentSlot = BigInt(meta.slot);
    const leaderSnapshot = await readCachedLeaderSnapshot(redis, currentSlot);
    const snapshot = {
      slot: meta.slot,
      blockhash: meta.blockhash,
      parentSlot: meta.parentSlot,
      parentBlockhash: meta.parentBlockhash,
      executedTransactionCount: meta.executedTransactionCount,
      entriesCount: meta.entriesCount,
      blockHeight: meta.blockHeight?.blockHeight,
      observedAt: new Date().toISOString(),
    };
    const networkSnapshot: NetworkSnapshot = {
      currentSlot,
      blockhash: meta.blockhash,
      parentSlot: BigInt(meta.parentSlot),
      parentBlockhash: meta.parentBlockhash,
      executedTransactionCount: BigInt(meta.executedTransactionCount),
      entriesCount: BigInt(meta.entriesCount),
      blockHeight: meta.blockHeight?.blockHeight ? BigInt(meta.blockHeight.blockHeight) : undefined,
      observedAt: new Date(),
      ...leaderSnapshot,
    };

    console.log(
      `Block ${meta.slot}: ${meta.executedTransactionCount} txs, parent ${meta.parentSlot}, hash ${meta.blockhash.slice(0, 12)}...`,
    );
    logNetworkSnapshot(networkSnapshot);

    void redis.set(REDIS_KEYS.networkSlotMeta, JSON.stringify(snapshot)).catch((error: unknown) => {
      console.error(`Failed to write ${REDIS_KEYS.networkSlotMeta}:`, error);
    });
  };

  const processUpdate = async (update: SubscribeUpdate) => {
    await handleBlockMeta(update);
  };

  const drainQueue = async () => {
    if (queueDraining) {
      return;
    }

    queueDraining = true;
    try {
      while (updateQueue.length > 0) {
        const update = updateQueue.shift();
        if (!update) {
          continue;
        }

        await processUpdate(update);
      }
    } catch (error) {
      console.error("Yellowstone update worker failed:", error);
    } finally {
      queueDraining = false;
      if (updateQueue.length > 0) {
        void drainQueue();
      }
    }
  };

  const enqueueUpdate = (update: SubscribeUpdate) => {
    if (updateQueue.length >= UPDATE_QUEUE_LIMIT) {
      droppedUpdates += 1;
      if (droppedUpdates === 1 || droppedUpdates % 100 === 0) {
        console.warn(
          `Yellowstone update queue full; dropped ${droppedUpdates} block metadata update(s).`,
        );
      }
      return;
    }

    updateQueue.push(update);
    void drainQueue();
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

    if (hasProcessableUpdate(update)) {
      enqueueUpdate(update);
    }
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
