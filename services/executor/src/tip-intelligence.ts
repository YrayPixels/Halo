import { Connection, PublicKey } from "@solana/web3.js";

const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
];

export async function calculateDynamicTip(
  connection: Connection,
  options: { floorTip: number },
): Promise<{ tipLamports: number }> {
  const prioritizationFees = await connection.getRecentPrioritizationFees().catch(() => []);
  const feeValues = prioritizationFees
    .map((entry) => entry.prioritizationFee)
    .filter((fee) => fee > 0)
    .sort((a, b) => a - b);

  const networkMedianFee =
    feeValues.length > 0 ? feeValues[Math.floor(feeValues.length / 2)]! : 1_000;

  const balances = await Promise.all(
    JITO_TIP_ACCOUNTS.map((address) =>
      connection.getBalance(new PublicKey(address)).catch(() => 0),
    ),
  );

  const recentTipActivity = balances.reduce((sum, balance) => sum + balance, 0);
  const activityFactor = recentTipActivity > 50_000_000_000 ? 1.35 : recentTipActivity > 20_000_000_000 ? 1.2 : 1.0;

  const tipLamports = Math.max(
    options.floorTip,
    Math.ceil(networkMedianFee * 8 * activityFactor),
  );

  return { tipLamports };
}
