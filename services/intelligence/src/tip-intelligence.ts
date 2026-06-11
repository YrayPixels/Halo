import { Connection, PublicKey } from "@solana/web3.js";
import type { FailureClass } from "@halo/types";

const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DxvWMxgVjGvnPQBBMw5jDZfv",
  "ADuUkR4vqLUMWXxW9gh6D6EW8xc3Me3JLyLttCX2p9DJ",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export interface TipRecommendation {
  tipLamports: number;
  reasoning: string;
  networkMedianFee: number;
  recentTipActivity: number;
}

export async function calculateDynamicTip(
  connection: Connection,
  options: {
    failureClass: FailureClass;
    currentTip: bigint | null;
    floorTip: number;
  },
): Promise<TipRecommendation> {
  const prioritizationFees = await connection.getRecentPrioritizationFees().catch(() => []);
  const feeValues = prioritizationFees
    .map((entry) => entry.prioritizationFee)
    .filter((fee) => fee > 0)
    .sort((a, b) => a - b);

  const networkMedianFee =
    feeValues.length > 0 ? feeValues[Math.floor(feeValues.length / 2)]! : 1_000;

  const balances = await Promise.all(
    JITO_TIP_ACCOUNTS.slice(0, 4).map((address) =>
      connection.getBalance(new PublicKey(address)).catch(() => 0),
    ),
  );

  const recentTipActivity = balances.reduce((sum, balance) => sum + balance, 0);
  const activityFactor = recentTipActivity > 50_000_000_000 ? 1.35 : recentTipActivity > 20_000_000_000 ? 1.2 : 1.0;

  const currentTip = Number(options.currentTip ?? options.floorTip);
  let multiplier = 1.0;

  switch (options.failureClass) {
    case "TIP_TOO_LOW":
    case "BUNDLE_REJECTED":
      multiplier = 1.45;
      break;
    case "BLOCKHASH_EXPIRED":
      multiplier = 1.15;
      break;
    case "LEADER_SKIPPED":
      multiplier = 1.1;
      break;
    case "COMPUTE_EXCEEDED":
      multiplier = 1.05;
      break;
    default:
      multiplier = 1.25;
  }

  const dynamicBase = Math.max(
    options.floorTip,
    Math.ceil(networkMedianFee * 8 * activityFactor),
  );

  const tipLamports = Math.max(
    Math.ceil(currentTip * multiplier),
    dynamicBase,
    options.floorTip,
  );

  return {
    tipLamports,
    reasoning: `Median prioritization fee ${networkMedianFee} lamports, tip-account activity factor ${activityFactor.toFixed(2)}, failure multiplier ${multiplier.toFixed(2)} → ${tipLamports} lamports.`,
    networkMedianFee,
    recentTipActivity,
  };
}
