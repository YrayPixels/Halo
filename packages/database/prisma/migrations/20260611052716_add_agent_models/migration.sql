-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "agentProcessed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "failureClass" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "lastValidBlockHeight" BIGINT,
ADD COLUMN     "parentTransactionId" TEXT,
ADD COLUMN     "submittedSlot" BIGINT;

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "failureClass" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "recommendedTipLamports" BIGINT NOT NULL,
    "shouldRetry" BOOLEAN NOT NULL,
    "leaderSlotsAway" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentComm" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT,
    "fromAgent" TEXT NOT NULL,
    "toAgent" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentComm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentDecision_transactionId_idx" ON "AgentDecision"("transactionId");

-- CreateIndex
CREATE INDEX "AgentDecision_createdAt_idx" ON "AgentDecision"("createdAt");

-- CreateIndex
CREATE INDEX "AgentStep_transactionId_idx" ON "AgentStep"("transactionId");

-- CreateIndex
CREATE INDEX "AgentStep_createdAt_idx" ON "AgentStep"("createdAt");

-- CreateIndex
CREATE INDEX "AgentComm_transactionId_idx" ON "AgentComm"("transactionId");

-- CreateIndex
CREATE INDEX "AgentComm_createdAt_idx" ON "AgentComm"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_agentProcessed_idx" ON "Transaction"("agentProcessed");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_parentTransactionId_fkey" FOREIGN KEY ("parentTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentComm" ADD CONSTRAINT "AgentComm_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
