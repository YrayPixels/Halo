import { Connection, PublicKey } from "@solana/web3.js";

const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
];

export interface TipRecommendation {
  tipLamports: number;
  source: string;
  networkMedianFee: number;
  recentTipActivity: number;
}

async function getRecentTipActivity(connection: Connection): Promise<number> {
  const samples = await Promise.all(
    JITO_TIP_ACCOUNTS.map(async (address) => {
      const tipAccount = new PublicKey(address);
      const signatures = await connection
        .getSignaturesForAddress(tipAccount, { limit: 5 }, "confirmed")
        .catch(() => []);

      const transactions = await Promise.all(
        signatures.map((signature) =>
          connection
            .getParsedTransaction(signature.signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            })
            .catch(() => null),
        ),
      );

      return transactions.reduce((sum, transaction) => {
        if (!transaction?.meta) {
          return sum;
        }

        const accountIndex = transaction.transaction.message.accountKeys.findIndex(
          (account) => account.pubkey.toBase58() === address,
        );

        if (accountIndex < 0) {
          return sum;
        }

        const preBalance = transaction.meta.preBalances[accountIndex] ?? 0;
        const postBalance = transaction.meta.postBalances[accountIndex] ?? 0;
        return sum + Math.max(0, postBalance - preBalance);
      }, 0);
    }),
  );

  return samples.reduce((sum, value) => sum + value, 0);
}

export async function calculateDynamicTip(
  connection: Connection,
  options: { floorTip: number },
): Promise<TipRecommendation> {
  const prioritizationFees = await connection.getRecentPrioritizationFees().catch(() => []);
  const feeValues = prioritizationFees
    .map((entry) => entry.prioritizationFee)
    .filter((fee) => fee > 0)
    .sort((a, b) => a - b);

  const networkMedianFee =
    feeValues.length > 0 ? feeValues[Math.floor(feeValues.length / 2)]! : 0;
  const recentTipActivity = await getRecentTipActivity(connection);
  const activityFactor = recentTipActivity > 50_000_000_000 ? 1.35 : recentTipActivity > 20_000_000_000 ? 1.2 : 1.0;

  const tipLamports = Math.max(
    options.floorTip,
    Math.ceil(networkMedianFee * 8 * activityFactor),
  );

  return {
    tipLamports,
    source: "recent_prioritization_fees+jito_tip_account_deltas",
    networkMedianFee,
    recentTipActivity,
  };
}
