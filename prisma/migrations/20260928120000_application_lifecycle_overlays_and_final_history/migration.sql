ALTER TABLE "Application"
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledById" UUID,
ADD COLUMN "cancelReason" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedById" UUID,
ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "Application_workspaceId_cancelledAt_archivedAt_idx"
ON "Application"("workspaceId", "cancelledAt", "archivedAt");

CREATE TABLE "ApplicationFinalDecisionHistory" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "finalStatus" "FinalStatus" NOT NULL,
    "finalLevel" "Level",
    "finalNote" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" UUID,
    "supersededAt" TIMESTAMP(3) NOT NULL,
    "supersededById" UUID,
    "supersedeReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationFinalDecisionHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicationFinalDecisionHistory_applicationId_supersededAt_idx"
ON "ApplicationFinalDecisionHistory"("applicationId", "supersededAt");
CREATE INDEX "ApplicationFinalDecisionHistory_supersededById_idx"
ON "ApplicationFinalDecisionHistory"("supersededById");

ALTER TABLE "Application"
ADD CONSTRAINT "Application_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "Application_archivedById_fkey"
FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApplicationFinalDecisionHistory"
ADD CONSTRAINT "ApplicationFinalDecisionHistory_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "ApplicationFinalDecisionHistory_finalizedById_fkey"
FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "ApplicationFinalDecisionHistory_supersededById_fkey"
FOREIGN KEY ("supersededById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
