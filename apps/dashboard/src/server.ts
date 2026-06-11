import { config } from "dotenv";
import express from "express";
import { Redis } from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  getLatestAgentDecision,
  getLatestAgentFlow,
  getRecentAgentComms,
  prisma,
} from "@halo/database";
import type { AgentFlowStep, AgentTone } from "@halo/types";
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
  failureClass: string | null;
  failureReason: string | null;
  attempt: number;
}

function serializeBigInt(value: bigint | number | null): string | null {
  if (value === null) {
    return null;
  }

  return value.toString();
}

app.get("/api/overview", async (_request, response) => {
  try {
    const [currentSlot, transactions, statusRows, agentSteps, agentComms, latestDecision] =
      await Promise.all([
        redis.get(REDIS_KEYS.networkCurrentSlot),
        prisma.transaction.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
        }) as Promise<TransactionRow[]>,
        prisma.transaction.findMany({
          select: { status: true },
        }),
        getLatestAgentFlow(),
        getRecentAgentComms(30),
        getLatestAgentDecision(),
      ]);

    const counts = statusRows.reduce<Record<string, number>>((accumulator, row) => {
      accumulator[row.status] = (accumulator[row.status] ?? 0) + 1;
      return accumulator;
    }, {});

    const flowSteps: AgentFlowStep[] = agentSteps.map((step) => ({
      id: step.id,
      agentName: step.agentName,
      label: step.label,
      note: step.note,
      tone: step.tone as AgentTone,
      stepOrder: step.stepOrder,
      transactionId: step.transactionId,
      createdAt: step.createdAt.toISOString(),
    }));

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
        failureClass: transaction.failureClass,
        failureReason: transaction.failureReason,
        attempt: transaction.attempt,
      })),
      agents: {
        flowSteps,
        comms: agentComms
          .slice()
          .reverse()
          .map((comm) => ({
            id: comm.id,
            fromAgent: comm.fromAgent,
            toAgent: comm.toAgent,
            message: comm.message,
            transactionId: comm.transactionId,
            createdAt: comm.createdAt.toISOString(),
          })),
        latestDecision: latestDecision
          ? {
              id: latestDecision.id,
              transactionId: latestDecision.transactionId,
              failureClass: latestDecision.failureClass,
              reasoning: latestDecision.reasoning,
              action: latestDecision.action,
              recommendedTipLamports: latestDecision.recommendedTipLamports.toString(),
              shouldRetry: latestDecision.shouldRetry,
              leaderSlotsAway: latestDecision.leaderSlotsAway,
              createdAt: latestDecision.createdAt.toISOString(),
              bundleId: latestDecision.transaction.bundleId,
            }
          : null,
      },
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
