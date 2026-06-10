-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "signature" TEXT,
    "bundleId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "slot" BIGINT,
    "tipLamports" BIGINT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_signature_idx" ON "Transaction"("signature");

-- CreateIndex
CREATE INDEX "Transaction_bundleId_idx" ON "Transaction"("bundleId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");
