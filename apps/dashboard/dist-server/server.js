import { config } from "dotenv";
import { PublicKey } from "@solana/web3.js";
import express from "express";
import { Redis } from "ioredis";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { getLatestAgentDecision, getLatestAgentFlow, getRecentAgentComms, prisma, } from "@halo/database";
import { enqueueLifecycleSignature, optionalEnv, parseRetryRequestEvent, parseTxEvent, REDIS_KEYS, REDIS_STREAMS, } from "@halo/shared";
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
function parseOptionalBigInt(value) {
    if (!value) {
        return undefined;
    }
    try {
        return BigInt(value);
    }
    catch {
        return undefined;
    }
}
function parseOptionalInteger(value) {
    if (!value) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
function serializeLogDetails(details) {
    return Object.fromEntries(Object.entries(details).flatMap(([key, value]) => {
        if (value === undefined) {
            return [];
        }
        return [[key, typeof value === "bigint" ? value.toString() : value]];
    }));
}
function inferTransactionLevel(status) {
    if (status === "FAILED") {
        return "error";
    }
    if (status === "PROCESSED" || status === "CONFIRMED") {
        return "warning";
    }
    return "info";
}
async function readRecentStream(stream, limit) {
    return redis.xrevrange(stream, "+", "-", "COUNT", limit);
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
        const [currentSlot, recommendedTip, networkMedianPriorityFee, tipAccountActivity, nextJitoLeaderSlot, nextJitoLeaderIdentity, nextJitoLeaderSlotsAway,] = await Promise.all([
            redis.get(REDIS_KEYS.networkCurrentSlot),
            redis.get(REDIS_KEYS.recommendedTip),
            redis.get(REDIS_KEYS.networkMedianPriorityFee),
            redis.get(REDIS_KEYS.tipAccountActivity),
            redis.get(REDIS_KEYS.nextJitoLeaderSlot),
            redis.get(REDIS_KEYS.nextJitoLeaderIdentity),
            redis.get(REDIS_KEYS.nextJitoLeaderSlotsAway),
        ]);
        const existing = await prisma.transaction.findFirst({ where: { signature } });
        if (!existing) {
            await prisma.transaction.create({
                data: {
                    status: "SUBMITTED",
                    signature,
                    bundleId: `wallet-${signature.slice(0, 12)}`,
                    tipLamports: parseOptionalBigInt(recommendedTip),
                    tipSource: `wallet_test:${wallet}->${destination}:${lamports}`,
                    networkMedianFee: parseOptionalBigInt(networkMedianPriorityFee),
                    tipAccountActivity: parseOptionalBigInt(tipAccountActivity),
                    attempt: 1,
                    maxAttempts: 1,
                    submittedSlot: parseOptionalBigInt(currentSlot),
                    targetLeaderSlot: parseOptionalBigInt(nextJitoLeaderSlot),
                    targetLeaderIdentity: nextJitoLeaderIdentity ?? undefined,
                    leaderSlotsAway: parseOptionalInteger(nextJitoLeaderSlotsAway),
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
app.get("/api/logs", async (request, response) => {
    try {
        const requestedSystem = typeof request.query.system === "string" ? request.query.system : "all";
        const limit = Math.min(Math.max(Number(request.query.limit ?? 150), 25), 300);
        const perSourceLimit = Math.max(30, Math.ceil(limit / 3));
        const [agentComms, agentSteps, agentDecisions, transactions, txEvents, retryRequests,] = await Promise.all([
            prisma.agentComm.findMany({
                orderBy: { createdAt: "desc" },
                take: perSourceLimit,
            }),
            prisma.agentStep.findMany({
                orderBy: { createdAt: "desc" },
                take: perSourceLimit,
            }),
            prisma.agentDecision.findMany({
                orderBy: { createdAt: "desc" },
                take: perSourceLimit,
                include: {
                    transaction: {
                        select: {
                            bundleId: true,
                            signature: true,
                        },
                    },
                },
            }),
            prisma.transaction.findMany({
                orderBy: { createdAt: "desc" },
                take: perSourceLimit,
            }),
            readRecentStream(REDIS_STREAMS.txEvents, perSourceLimit),
            readRecentStream(REDIS_STREAMS.retryRequests, perSourceLimit),
        ]);
        const logs = [
            ...agentComms.map((comm) => ({
                id: `agent-comm:${comm.id}`,
                timestamp: comm.createdAt.toISOString(),
                system: comm.fromAgent,
                level: "info",
                category: "agent_comm",
                message: `${comm.fromAgent} -> ${comm.toAgent}: ${comm.message}`,
                transactionId: comm.transactionId ?? undefined,
                details: serializeLogDetails({
                    toAgent: comm.toAgent,
                }),
            })),
            ...agentSteps.map((step) => ({
                id: `agent-step:${step.id}`,
                timestamp: step.createdAt.toISOString(),
                system: step.agentName,
                level: step.tone === "danger" ? "error" : step.tone === "warning" ? "warning" : "info",
                category: "agent_step",
                message: `${step.label}: ${step.note}`,
                transactionId: step.transactionId,
                details: serializeLogDetails({
                    stepOrder: step.stepOrder,
                    tone: step.tone,
                }),
            })),
            ...agentDecisions.map((decision) => ({
                id: `agent-decision:${decision.id}`,
                timestamp: decision.createdAt.toISOString(),
                system: "orchestrator",
                level: decision.shouldRetry ? "warning" : "error",
                category: "agent_decision",
                message: `${decision.action}: ${decision.reasoning}`,
                transactionId: decision.transactionId,
                details: serializeLogDetails({
                    failureClass: decision.failureClass,
                    recommendedTipLamports: decision.recommendedTipLamports,
                    shouldRetry: decision.shouldRetry,
                    leaderSlotsAway: decision.leaderSlotsAway,
                    bundleId: decision.transaction.bundleId,
                    signature: decision.transaction.signature,
                }),
            })),
            ...transactions.map((transaction) => ({
                id: `transaction:${transaction.id}`,
                timestamp: transaction.createdAt.toISOString(),
                system: "database",
                level: inferTransactionLevel(transaction.status),
                category: "transaction_lifecycle",
                message: `Transaction ${transaction.status}${transaction.failureReason ? `: ${transaction.failureReason}` : ""}`,
                transactionId: transaction.id,
                details: serializeLogDetails({
                    signature: transaction.signature,
                    bundleId: transaction.bundleId,
                    status: transaction.status,
                    attempt: transaction.attempt,
                    maxAttempts: transaction.maxAttempts,
                    errorMessage: transaction.errorMessage,
                    failureClass: transaction.failureClass,
                    failureSource: transaction.bundleFailureSource,
                    slot: transaction.slot,
                }),
            })),
            ...txEvents.flatMap(([id, fields]) => {
                const event = parseTxEvent(fields);
                if (!event) {
                    return [];
                }
                return [{
                        id: `tx-event:${id}`,
                        timestamp: event.observedAt,
                        system: event.source,
                        level: event.status === "FAILED" ? "error" : "info",
                        category: "tx_stream",
                        message: `${event.status} transaction ${event.signature.slice(0, 12)}... at slot ${event.slot}`,
                        details: serializeLogDetails({
                            signature: event.signature,
                            slot: event.slot,
                            source: event.source,
                            errorMessage: event.errorMessage,
                        }),
                    }];
            }),
            ...retryRequests.flatMap(([id, fields]) => {
                const event = parseRetryRequestEvent(fields);
                if (!event) {
                    return [];
                }
                return [{
                        id: `retry-request:${id}`,
                        timestamp: event.observedAt,
                        system: "executor",
                        level: "warning",
                        category: "retry_request",
                        message: `${event.action} with ${event.tipLamports} lamports`,
                        transactionId: event.parentTransactionId,
                        details: serializeLogDetails({
                            decisionId: event.decisionId,
                            waitForLeader: event.waitForLeader,
                        }),
                    }];
            }),
        ];
        const systems = Array.from(new Set(logs.map((log) => log.system))).sort((left, right) => left.localeCompare(right));
        const filteredLogs = requestedSystem === "all"
            ? logs
            : logs.filter((log) => log.system.toLowerCase() === requestedSystem.toLowerCase());
        response.json({
            systems,
            logs: filteredLogs
                .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
                .slice(0, limit),
        });
    }
    catch (error) {
        console.error("Failed to load dashboard logs:", error);
        response.status(500).json({ error: "Failed to load dashboard logs" });
    }
});
app.get("/api/overview", async (_request, response) => {
    try {
        const [currentSlot, currentLeader, nextJitoLeaderSlot, nextJitoLeaderIdentity, nextJitoLeaderSlotsAway, recommendedSubmitSlot, recommendedTip, networkMedianPriorityFee, tipAccountActivity, slotMetaRaw, transactions, countRows, agentSteps, agentComms, latestDecision,] = await Promise.all([
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
                select: {
                    status: true,
                    processedAt: true,
                    confirmedAt: true,
                    finalizedAt: true,
                },
            }),
            getLatestAgentFlow(),
            getRecentAgentComms(30),
            getLatestAgentDecision(),
        ]);
        const counts = countRows.reduce((accumulator, row) => {
            accumulator.SUBMITTED += 1;
            if (row.processedAt || row.confirmedAt || row.finalizedAt || ["PROCESSED", "CONFIRMED", "FINALIZED"].includes(row.status)) {
                accumulator.PROCESSED += 1;
            }
            if (row.confirmedAt || row.finalizedAt || ["CONFIRMED", "FINALIZED"].includes(row.status)) {
                accumulator.CONFIRMED += 1;
            }
            if (row.finalizedAt || row.status === "FINALIZED") {
                accumulator.FINALIZED += 1;
            }
            if (row.status === "FAILED") {
                accumulator.FAILED += 1;
            }
            return accumulator;
        }, { SUBMITTED: 0, PROCESSED: 0, CONFIRMED: 0, FINALIZED: 0, FAILED: 0 });
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