import { config } from "dotenv";
import express from "express";
import { Redis } from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { prisma } from "@halo/database";
import { optionalEnv, REDIS_KEYS } from "@halo/shared";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(appDir, "../..");
const port = Number(process.env.PORT ?? 5173);

config({ path: resolve(rootDir, ".env") });

const redis = new Redis(optionalEnv("REDIS_URL", "redis://localhost:6379"));
const app = express();

interface TransactionRow {
  id: string;
  signature: string | null;
  bundleId: string | null;
  status: string;
  createdAt: Date;
  processedAt: Date | null;
  confirmedAt: Date | null;
  finalizedAt: Date | null;
  slot: bigint | null;
  tipLamports: bigint | null;
}

function serializeBigInt(value: bigint | number | null): string | null {
  if (value === null) {
    return null;
  }

  return value.toString();
}

app.get("/api/overview", async (_request, response) => {
  try {
    const [currentSlot, transactions, statusRows] = await Promise.all([
      redis.get(REDIS_KEYS.networkCurrentSlot),
      prisma.transaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      }) as Promise<TransactionRow[]>,
      prisma.transaction.findMany({
        select: { status: true },
      }),
    ]);

    const counts = statusRows.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row.status] = (accumulator[row.status] ?? 0) + 1;
      return accumulator;
    }, {});

    response.json({
      currentSlot,
      counts,
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        signature: transaction.signature,
        bundleId: transaction.bundleId,
        status: transaction.status,
        createdAt: transaction.createdAt.toISOString(),
        processedAt: transaction.processedAt?.toISOString() ?? null,
        confirmedAt: transaction.confirmedAt?.toISOString() ?? null,
        finalizedAt: transaction.finalizedAt?.toISOString() ?? null,
        slot: serializeBigInt(transaction.slot),
        tipLamports: serializeBigInt(transaction.tipLamports),
      })),
    });
  } catch (error) {
    console.error("Failed to load dashboard overview:", error);
    response.status(500).json({ error: "Failed to load dashboard overview" });
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve(appDir, "dist")));
  app.get("*", (_request, response) => {
    response.sendFile(resolve(appDir, "dist/index.html"));
  });
} else {
  const vite = await createViteServer({
    root: appDir,
    server: { middlewareMode: true },
    appType: "spa",
  });

  app.use(vite.middlewares);
}

app.listen(port, () => {
  console.log(`HALO dashboard listening on http://localhost:${port}`);
});
