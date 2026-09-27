-- CreateEnum
CREATE TYPE "AwardLevel" AS ENUM ('SCHOOL', 'UNIVERSITY_SYSTEM');

-- CreateEnum
CREATE TYPE "AwardDecisionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AwardRecipientMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'CONFLICT');

-- CreateTable
CREATE TABLE "AwardDecision" (
    "id" UUID NOT NULL,
    "issuerWorkspaceId" UUID NOT NULL,
    "awardLevel" "AwardLevel" NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "decisionNumber" TEXT,
    "decisionDate" TIMESTAMP(3),
    "decisionFileId" UUID,
    "rosterFileId" UUID,
    "sourceImportId" UUID,
    "status" "AwardDecisionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwardDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AwardRecipient" (
    "id" UUID NOT NULL,
    "awardDecisionId" UUID NOT NULL,
    "studentCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "institutionWorkspaceId" UUID,
    "className" TEXT,
    "matchedUserId" UUID,
    "matchStatus" "AwardRecipientMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "sourceRow" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AwardRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AwardDecision_issuerWorkspaceId_schoolYear_idx" ON "AwardDecision"("issuerWorkspaceId", "schoolYear");

-- CreateIndex
CREATE INDEX "AwardDecision_awardLevel_idx" ON "AwardDecision"("awardLevel");

-- CreateIndex
CREATE INDEX "AwardDecision_status_idx" ON "AwardDecision"("status");

-- CreateIndex
CREATE INDEX "AwardDecision_decisionFileId_idx" ON "AwardDecision"("decisionFileId");

-- CreateIndex
CREATE INDEX "AwardDecision_rosterFileId_idx" ON "AwardDecision"("rosterFileId");

-- CreateIndex
CREATE INDEX "AwardDecision_sourceImportId_idx" ON "AwardDecision"("sourceImportId");

-- CreateIndex
CREATE INDEX "AwardDecision_createdById_idx" ON "AwardDecision"("createdById");

-- CreateIndex
CREATE INDEX "AwardRecipient_awardDecisionId_idx" ON "AwardRecipient"("awardDecisionId");

-- CreateIndex
CREATE INDEX "AwardRecipient_studentCode_idx" ON "AwardRecipient"("studentCode");

-- CreateIndex
CREATE INDEX "AwardRecipient_matchedUserId_idx" ON "AwardRecipient"("matchedUserId");

-- CreateIndex
CREATE INDEX "AwardRecipient_institutionWorkspaceId_idx" ON "AwardRecipient"("institutionWorkspaceId");

-- AddForeignKey
ALTER TABLE "AwardDecision" ADD CONSTRAINT "AwardDecision_issuerWorkspaceId_fkey" FOREIGN KEY ("issuerWorkspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardDecision" ADD CONSTRAINT "AwardDecision_decisionFileId_fkey" FOREIGN KEY ("decisionFileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardDecision" ADD CONSTRAINT "AwardDecision_rosterFileId_fkey" FOREIGN KEY ("rosterFileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardDecision" ADD CONSTRAINT "AwardDecision_sourceImportId_fkey" FOREIGN KEY ("sourceImportId") REFERENCES "DecisionImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardDecision" ADD CONSTRAINT "AwardDecision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardDecision" ADD CONSTRAINT "AwardDecision_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecipient" ADD CONSTRAINT "AwardRecipient_awardDecisionId_fkey" FOREIGN KEY ("awardDecisionId") REFERENCES "AwardDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecipient" ADD CONSTRAINT "AwardRecipient_institutionWorkspaceId_fkey" FOREIGN KEY ("institutionWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardRecipient" ADD CONSTRAINT "AwardRecipient_matchedUserId_fkey" FOREIGN KEY ("matchedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
