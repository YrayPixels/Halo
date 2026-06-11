import type { Redis } from "ioredis";
import { advanceTransactionStatus } from "@halo/database";
import type { TransactionStatus } from "@halo/types";
import {
  ejectLifecycleSignature,
  ensureConsumerGroup,
  enqueueLifecycleSignature,
  parseTxEvent,
  REDIS_GROUPS,
  REDIS_STREAMS,
  updateLifecycleQueueStatus,
} from "@halo/shared";

const CONSUMER_NAME = "tracker-1";

type StreamMessage = [messageId: string, fields: string[]];
type StreamReadResponse = [streamKey: string, messages: StreamMessage[]][];

export async function startEventConsumer(redis: Redis): Promise<() => void> {
  await ensureConsumerGroup(redis, REDIS_STREAMS.txEvents, REDIS_GROUPS.tracker);

  let running = true;

  const consume = async () => {
    while (running) {
      const response = (await redis.xreadgroup(
        "GROUP",
        REDIS_GROUPS.tracker,
        CONSUMER_NAME,
        "COUNT",
        10,
        "BLOCK",
        2000,
        "STREAMS",
        REDIS_STREAMS.txEvents,
        ">",
      )) as StreamReadResponse | null;

      if (!response) {
        continue;
      }

      for (const [, messages] of response) {
        for (const [messageId, fields] of messages) {
          const event = parseTxEvent(fields);

          if (!event) {
            await redis.xack(REDIS_STREAMS.txEvents, REDIS_GROUPS.tracker, messageId);
            continue;
          }

          try {
            const advanced = await advanceTransactionStatus(event.signature, event.status, {
              slot: BigInt(event.slot),
              errorMessage:
                event.status === "FAILED"
                  ? event.errorMessage ?? "Transaction failed on-chain (stream observation)"
                  : undefined,
              observedAt: new Date(event.observedAt),
              source: event.source,
            });

            if (advanced) {
              if (event.status === "FAILED") {
                await ejectLifecycleSignature(redis, event.signature);
                console.log(`${event.signature.slice(0, 12)}... ejected from lifecycle queue (stream FAILED)`);
              } else if (event.status === "PROCESSED") {
                await updateLifecycleQueueStatus(redis, event.signature, "PROCESSED", event.slot);
              } else if (event.status === "CONFIRMED") {
                await updateLifecycleQueueStatus(redis, event.signature, "CONFIRMED", event.slot);
              } else if (event.status === "FINALIZED") {
                await ejectLifecycleSignature(redis, event.signature);
              }
            }

            await redis.xack(REDIS_STREAMS.txEvents, REDIS_GROUPS.tracker, messageId);
          } catch (error) {
            console.error(`Failed to process tx event ${messageId}:`, error);
          }
        }
      }
    }
  };

  void consume().catch((error: unknown) => {
    console.error("Redis event consumer failed:", error);
  });

  return () => {
    running = false;
  };
}

export async function hydrateLifecycleQueue(
  redis: Redis,
  watchlist: Map<string, TransactionStatus>,
): Promise<void> {
  for (const [signature, status] of watchlist) {
    if (status === "SUBMITTED" || status === "PROCESSED" || status === "CONFIRMED") {
      await enqueueLifecycleSignature(redis, signature, status);
    }
  }
}
