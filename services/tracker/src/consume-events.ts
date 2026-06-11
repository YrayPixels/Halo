import type { Redis } from "ioredis";
import { advanceTransactionStatus } from "@halo/database";
import {
  ensureConsumerGroup,
  parseTxEvent,
  REDIS_GROUPS,
  REDIS_STREAMS,
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
            await advanceTransactionStatus(event.signature, event.status, {
              slot: BigInt(event.slot),
              errorMessage:
                event.status === "FAILED"
                  ? "Transaction failed on-chain (stream observation)"
                  : undefined,
            });
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
