CREATE TYPE "EmailOutboxStatus" AS ENUM (
  'queued',
  'sending',
  'sent',
  'failed',
  'cancelled'
);

CREATE TABLE "EmailOutbox" (
  "id" UUID NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "recipientName" TEXT,
  "subject" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "payloadJson" JSONB,
  "status" "EmailOutboxStatus" NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "relatedUserId" UUID,
  "applicationId" UUID,
  "notificationId" UUID,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutbox_dedupeKey_key" ON "EmailOutbox"("dedupeKey");
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");
CREATE INDEX "EmailOutbox_relatedUserId_idx" ON "EmailOutbox"("relatedUserId");
CREATE INDEX "EmailOutbox_applicationId_idx" ON "EmailOutbox"("applicationId");
CREATE INDEX "EmailOutbox_notificationId_idx" ON "EmailOutbox"("notificationId");
CREATE INDEX "EmailOutbox_templateKey_idx" ON "EmailOutbox"("templateKey");
