-- Complete transaction-stack observability and retry metadata.
ALTER TABLE "Transaction"
ADD COLUMN     "processedSlot" BIGINT,
ADD COLUMN     "confirmedSlot" BIGINT,
ADD COLUMN     "finalizedSlot" BIGINT,
ADD COLUMN     "processedViaStream" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confirmedViaStream" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "finalizedViaStream" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "submittedToProcessedMs" INTEGER,
ADD COLUMN     "processedToConfirmedMs" INTEGER,
ADD COLUMN     "confirmedToFinalizedMs" INTEGER,
ADD COLUMN     "submittedToFinalizedMs" INTEGER,
ADD COLUMN     "tipSource" TEXT,
ADD COLUMN     "networkMedianFee" BIGINT,
ADD COLUMN     "tipAccountActivity" BIGINT,
ADD COLUMN     "bundleFailureCode" TEXT,
ADD COLUMN     "bundleFailureSource" TEXT,
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "targetLeaderSlot" BIGINT,
ADD COLUMN     "targetLeaderIdentity" TEXT,
ADD COLUMN     "leaderSlotsAway" INTEGER;

-- Backfill stage-specific slots from the legacy generic slot when possible.
UPDATE "Transaction"
SET "processedSlot" = "slot"
WHERE "processedAt" IS NOT NULL AND "processedSlot" IS NULL;

UPDATE "Transaction"
SET "confirmedSlot" = "slot"
WHERE "confirmedAt" IS NOT NULL AND "confirmedSlot" IS NULL;

UPDATE "Transaction"
SET "finalizedSlot" = "slot"
WHERE "finalizedAt" IS NOT NULL AND "finalizedSlot" IS NULL;
