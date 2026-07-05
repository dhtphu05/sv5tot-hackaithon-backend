CREATE TABLE "chat_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "applicationId" UUID,
  "reviewTaskId" UUID,
  "resolutionCaseId" UUID,
  "provider" TEXT NOT NULL DEFAULT 'vnpt_smartbot',
  "providerSessionId" TEXT,
  "contextScope" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "sender" TEXT NOT NULL,
  "textRedacted" TEXT,
  "normalizedPayloadJson" JSONB,
  "providerStatus" INTEGER,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chatbot_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "actionType" TEXT NOT NULL,
  "toolName" TEXT,
  "label" TEXT NOT NULL,
  "route" TEXT,
  "queryJson" JSONB,
  "payloadJson" JSONB,
  "requiredRole" TEXT,
  "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "auditLogId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "chatbot_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chatbot_handoffs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "applicationId" UUID,
  "reviewTaskId" UUID,
  "resolutionCaseId" UUID,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "assignedOfficerId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "chatbot_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_sessions_userId_idx" ON "chat_sessions"("userId");
CREATE INDEX "chat_sessions_applicationId_idx" ON "chat_sessions"("applicationId");
CREATE INDEX "chat_messages_sessionId_idx" ON "chat_messages"("sessionId");
CREATE INDEX "chatbot_actions_sessionId_idx" ON "chatbot_actions"("sessionId");
CREATE INDEX "chatbot_actions_userId_idx" ON "chatbot_actions"("userId");
CREATE INDEX "chatbot_actions_status_idx" ON "chatbot_actions"("status");
CREATE INDEX "chatbot_handoffs_userId_idx" ON "chatbot_handoffs"("userId");
CREATE INDEX "chatbot_handoffs_status_idx" ON "chatbot_handoffs"("status");

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chatbot_actions"
  ADD CONSTRAINT "chatbot_actions_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chatbot_handoffs"
  ADD CONSTRAINT "chatbot_handoffs_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
