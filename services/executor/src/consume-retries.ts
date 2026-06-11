import { PublicKey } from "@solana/web3.js";
import type { Redis } from "ioredis";
import { getTransactionById } from "@halo/database";
import {
  ensureConsumerGroup,
  parseRetryRequestEvent,
  REDIS_GROUPS,
  REDIS_STREAMS,
} from "@halo/shared";
import type { Keypair } from "@solana/web3.js";
import { submitTransferBundle } from "./submit-bundle.js";

const CONSUMER_NAME = "executor-1";

type StreamMessage = [messageId: string, fields: string[]];
type StreamReadResponse = [streamKey: string, messages: StreamMessage[]][];

export async function startRetryConsumer(
  redis: Redis,
  options: {
    rpcUrl: string;
    blockEngineUrl: string;
    payer: Keypair;
    destination: PublicKey;
    transferLamports: number;
  },
): Promise<() => void> {
  await ensureConsumerGroup(redis, REDIS_STREAMS.retryRequests, REDIS_GROUPS.executor);

  let running = true;

  const consume = async () => {
    while (running) {
      const response = (await redis.xreadgroup(
        "GROUP",
        REDIS_GROUPS.executor,
        CONSUMER_NAME,
        "COUNT",
        5,
        "BLOCK",
        2000,
        "STREAMS",
        REDIS_STREAMS.retryRequests,
        ">",
      )) as StreamReadResponse | null;

      if (!response) {
        continue;
      }

      for (const [, messages] of response) {
        for (const [messageId, fields] of messages) {
          const event = parseRetryRequestEvent(fields);

          if (!event) {
            await redis.xack(REDIS_STREAMS.retryRequests, REDIS_GROUPS.executor, messageId);
            continue;
          }

          try {
            const parent = await getTransactionById(event.parentTransactionId);
            if (!parent) {
              throw new Error(`Parent transaction ${event.parentTransactionId} not found`);
            }

            const bundleId = await submitTransferBundle({
              rpcUrl: options.rpcUrl,
              blockEngineUrl: options.blockEngineUrl,
              payer: options.payer,
              destination: options.destination,
              transferLamports: options.transferLamports,
              tipLamports: Number(event.tipLamports),
              redis,
              parentTransactionId: parent.id,
              attempt: parent.attempt + 1,
              waitForLeader: event.waitForLeader === "true",
              injectExpiredBlockhash: false,
            });

            console.log(`Retry bundle submitted: ${bundleId} (decision ${event.decisionId})`);
            await redis.xack(REDIS_STREAMS.retryRequests, REDIS_GROUPS.executor, messageId);
          } catch (error) {
            console.error(`Failed to process retry request ${messageId}:`, error);
          }
        }
      }
    }
  };

  void consume().catch((error: unknown) => {
    console.error("Retry consumer failed:", error);
  });

  return () => {
    running = false;
  };
}
