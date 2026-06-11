import { config } from "dotenv";
import { PublicKey } from "@solana/web3.js";
import express from "express";
import { Redis } from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { getLatestAgentDecision, getLatestAgentFlow, getRecentAgentComms, prisma, } from "@halo/database";
import { enqueueLifecycleSignature, optionalEnv, REDIS_KEYS } from "@halo/shared";
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(appDir, "../..");
const port = Number(process.env.PORT ?? 5173);
config({ path: resolve(rootDir, ".env") });
const redis = new Redis(optionalEnv("REDIS_URL", "redis://localhost:6379"));
const app = express();
app.use(express.json());
function serializeBigInt(value) {
    if (value === null) {
        return null;
    }
    return value.toString();
}
function validateBase58PublicKey(value, fieldName) {
    if (typeof value !== "string") {
        throw new Error(`${fieldName} must be a string`);
    }
    return new PublicKey(value).toBase58();
}
function validateSignature(value) {
    if (typeof value !== "string" || value.length < 64 || value.length > 128) {
        throw new Error("signature must be a base58 transaction signature");
    }
    return value;
}
function validateLamports(value) {
    const lamports = Number(value);
    if (!Number.isSafeInteger(lamports) || lamports <= 0) {
        throw new Error("lamports must be a positive safe integer");
    }
    return lamports;
}
app.get("/api/wallet-test/config", (_request, response) => {
    response.json({
        rpcUrl: optionalEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
        destination: optionalEnv("WALLET_TEST_DESTINATION", optionalEnv("TRANSFER_DESTINATION", "")),
        lamports: Number(optionalEnv("WALLET_TEST_LAMPORTS", optionalEnv("TRANSFER_LAMPORTS", "1000"))),
    });
});
app.post("/api/wallet-test/register", async (request, response) => {
    try {
        const signature = validateSignature(request.body?.signature);
        const wallet = validateBase58PublicKey(request.body?.wallet, "wallet");
        const destination = validateBase58PublicKey(request.body?.destination, "destination");
        const lamports = validateLamports(request.body?.lamports);
        const currentSlot = await redis.get(REDIS_KEYS.networkCurrentSlot);
        const existing = await prisma.transaction.findFirst({ where: { signature } });
        if (!existing) {
            await prisma.transaction.create({
                data: {
                    status: "SUBMITTED",
                    signature,
                    bundleId: `wallet-${signature.slice(0, 12)}`,
                    tipSource: `wallet_test:${wallet}->${destination}:${lamports}`,
                    attempt: 1,
                    maxAttempts: 1,
                    submittedSlot: currentSlot ? BigInt(currentSlot) : undefined,
                },
            });
        }
        await enqueueLifecycleSignature(redis, signature, "SUBMITTED", currentSlot ?? undefined);
        response.json({ ok: true, signature });
    }
    catch (error) {
        response.status(400).json({
            error: error instanceof Error ? error.message : "Failed to register wallet transaction",
        });
    }
});
app.get("/api/overview", async (_request, response) => {
    try {
        const [currentSlot, currentLeader, nextJitoLeaderSlot, nextJitoLeaderIdentity, nextJitoLeaderSlotsAway, recommendedSubmitSlot, recommendedTip, networkMedianPriorityFee, tipAccountActivity, slotMetaRaw, transactions, statusRows, agentSteps, agentComms, latestDecision,] = await Promise.all([
            redis.get(REDIS_KEYS.networkCurrentSlot),
            redis.get(REDIS_KEYS.networkCurrentLeader),
            redis.get(REDIS_KEYS.nextJitoLeaderSlot),
            redis.get(REDIS_KEYS.nextJitoLeaderIdentity),
            redis.get(REDIS_KEYS.nextJitoLeaderSlotsAway),
            redis.get(REDIS_KEYS.recommendedSubmitSlot),
            redis.get(REDIS_KEYS.recommendedTip),
            redis.get(REDIS_KEYS.networkMedianPriorityFee),
            redis.get(REDIS_KEYS.tipAccountActivity),
            redis.get(REDIS_KEYS.networkSlotMeta),
            prisma.transaction.findMany({
                orderBy: { createdAt: "desc" },
                take: 20,
            }),
            prisma.transaction.findMany({
                select: { status: true },
            }),
            getLatestAgentFlow(),
            getRecentAgentComms(30),
            getLatestAgentDecision(),
        ]);
        const counts = statusRows.reduce((accumulator, row) => {
            accumulator[row.status] = (accumulator[row.status] ?? 0) + 1;
            return accumulator;
        }, {});
        const flowSteps = agentSteps.map((step) => ({
            id: step.id,
            agentName: step.agentName,
            label: step.label,
            note: step.note,
            tone: step.tone,
            stepOrder: step.stepOrder,
            transactionId: step.transactionId,
            createdAt: step.createdAt.toISOString(),
        }));
        let slotMeta = null;
        if (slotMetaRaw) {
            try {
                slotMeta = JSON.parse(slotMetaRaw);
            }
            catch {
                slotMeta = null;
            }
        }
        response.json({
            currentSlot,
            network: {
                currentLeader,
                nextJitoLeaderSlot,
                nextJitoLeaderIdentity,
                nextJitoLeaderSlotsAway,
                recommendedSubmitSlot,
                recommendedTip,
                networkMedianPriorityFee,
                tipAccountActivity,
                slotMeta,
            },
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
                processedSlot: serializeBigInt(transaction.processedSlot),
                confirmedSlot: serializeBigInt(transaction.confirmedSlot),
                finalizedSlot: serializeBigInt(transaction.finalizedSlot),
                processedViaStream: transaction.processedViaStream,
                confirmedViaStream: transaction.confirmedViaStream,
                finalizedViaStream: transaction.finalizedViaStream,
                submittedToProcessedMs: transaction.submittedToProcessedMs,
                processedToConfirmedMs: transaction.processedToConfirmedMs,
                confirmedToFinalizedMs: transaction.confirmedToFinalizedMs,
                submittedToFinalizedMs: transaction.submittedToFinalizedMs,
                tipLamports: serializeBigInt(transaction.tipLamports),
                tipSource: transaction.tipSource,
                networkMedianFee: serializeBigInt(transaction.networkMedianFee),
                tipAccountActivity: serializeBigInt(transaction.tipAccountActivity),
                failureClass: transaction.failureClass,
                failureReason: transaction.failureReason,
                bundleFailureCode: transaction.bundleFailureCode,
                bundleFailureSource: transaction.bundleFailureSource,
                attempt: transaction.attempt,
                maxAttempts: transaction.maxAttempts,
                submittedSlot: serializeBigInt(transaction.submittedSlot),
                targetLeaderSlot: serializeBigInt(transaction.targetLeaderSlot),
                targetLeaderIdentity: transaction.targetLeaderIdentity,
                leaderSlotsAway: transaction.leaderSlotsAway,
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
    }
    catch (error) {
        console.error("Failed to load dashboard overview:", error);
        response.status(500).json({ error: "Failed to load dashboard overview" });
    }
});
if (process.env.NODE_ENV === "production") {
    app.use(express.static(resolve(appDir, "dist")));
    app.get("*", (_request, response) => {
        response.sendFile(resolve(appDir, "dist/index.html"));
    });
}
else {
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
//# sourceMappingURL=server.js.map