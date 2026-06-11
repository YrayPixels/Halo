import type { Connection } from "@solana/web3.js";
import type { Redis } from "ioredis";
import { listLifecycleQueue, publishTxEvent } from "@halo/shared";

export async function promoteLifecycleQueue(
  connection: Connection,
  redis: Redis,
): Promise<void> {
  const queue = await listLifecycleQueue(redis);
  if (queue.length === 0) {
    return;
  }

  const signatures = queue.map((entry) => entry.signature);
  const response = await connection.getSignatureStatuses(signatures, {
    searchTransactionHistory: true,
  });

  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index]!;
    const status = response.value[index];

    if (!status) {
      continue;
    }

    const slot =
      status.slot !== null && status.slot !== undefined ? BigInt(status.slot) : undefined;

    if (status.err) {
      await publishTxEvent(redis, {
        signature,
        slot: slot?.toString() ?? "",
        status: "FAILED",
        observedAt: new Date().toISOString(),
        source: "rpc",
        errorMessage: JSON.stringify(status.err),
      });
      continue;
    }

    const confirmationStatus = status.confirmationStatus;

    if (confirmationStatus === "finalized") {
      await publishTxEvent(redis, {
        signature,
        slot: slot?.toString() ?? "",
        status: "FINALIZED",
        observedAt: new Date().toISOString(),
        source: "rpc",
      });
      continue;
    }

    if (confirmationStatus === "confirmed") {
      await publishTxEvent(redis, {
        signature,
        slot: slot?.toString() ?? "",
        status: "CONFIRMED",
        observedAt: new Date().toISOString(),
        source: "rpc",
      });
      continue;
    }

    if (confirmationStatus === "processed") {
      await publishTxEvent(redis, {
        signature,
        slot: slot?.toString() ?? "",
        status: "PROCESSED",
        observedAt: new Date().toISOString(),
        source: "rpc",
      });
    }
  }
}
