CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "ApprovedEvidenceApprovalSource" AS ENUM ('officer', 'resolution');

CREATE TYPE "ApprovedEvidencePrecedentStatus" AS ENUM ('active', 'revoked');

CREATE TYPE "EventRegistryAliasType" AS ENUM ('alias', 'acronym', 'abbreviation');

CREATE TYPE "EventRegistryAliasVerificationSource" AS ENUM ('officer', 'resolution', 'registry', 'manager');

CREATE TABLE "EventRegistryAlias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "criterion" "Criterion" NOT NULL,
  "alias" TEXT NOT NULL,
  "normalizedAliasKey" TEXT NOT NULL,
  "aliasType" "EventRegistryAliasType" NOT NULL DEFAULT 'alias',
  "verificationSource" "EventRegistryAliasVerificationSource" NOT NULL DEFAULT 'officer',
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventRegistryAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceAbbreviation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "normalizedTokenKey" TEXT NOT NULL,
  "expandedText" TEXT NOT NULL,
  "normalizedExpandedKey" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceAbbreviation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovedEvidencePrecedent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "criterion" "Criterion" NOT NULL,
  "eventId" UUID NOT NULL,
  "sourceEvidenceId" UUID NOT NULL,
  "sourceEvidenceCardId" UUID,
  "sourceReviewTaskId" UUID,
  "sourceResolutionCaseId" UUID,
  "previewFileId" UUID,
  "approvalSource" "ApprovedEvidenceApprovalSource" NOT NULL,
  "organizer" TEXT,
  "organizerLevel" "Level",
  "applicableLevel" "Level",
  "eventYear" INTEGER,
  "schoolYear" TEXT,
  "criteriaVersionId" UUID,
  "normalizedTitleKey" TEXT NOT NULL,
  "normalizedOrganizerKey" TEXT,
  "ocrSearchKey" TEXT,
  "ocrMetadataJson" JSONB,
  "auditSummaryJson" JSONB,
  "status" "ApprovedEvidencePrecedentStatus" NOT NULL DEFAULT 'active',
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApprovedEvidencePrecedent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventRegistryAlias_workspaceId_eventId_normalizedAliasKey_key" ON "EventRegistryAlias"("workspaceId", "eventId", "normalizedAliasKey");
CREATE INDEX "EventRegistryAlias_workspaceId_criterion_normalizedAliasKey_idx" ON "EventRegistryAlias"("workspaceId", "criterion", "normalizedAliasKey");
CREATE INDEX "EventRegistryAlias_workspaceId_normalizedAliasKey_idx" ON "EventRegistryAlias"("workspaceId", "normalizedAliasKey");
CREATE INDEX "EventRegistryAlias_eventId_idx" ON "EventRegistryAlias"("eventId");

CREATE UNIQUE INDEX "WorkspaceAbbreviation_workspaceId_normalizedTokenKey_key" ON "WorkspaceAbbreviation"("workspaceId", "normalizedTokenKey");
CREATE INDEX "WorkspaceAbbreviation_workspaceId_isActive_idx" ON "WorkspaceAbbreviation"("workspaceId", "isActive");

CREATE UNIQUE INDEX "ApprovedEvidencePrecedent_sourceEvidenceId_key" ON "ApprovedEvidencePrecedent"("sourceEvidenceId");
CREATE INDEX "ApprovedEvidencePrecedent_workspaceId_criterion_eventId_status_idx" ON "ApprovedEvidencePrecedent"("workspaceId", "criterion", "eventId", "status");
CREATE INDEX "ApprovedEvidencePrecedent_workspaceId_criterion_status_idx" ON "ApprovedEvidencePrecedent"("workspaceId", "criterion", "status");
CREATE INDEX "ApprovedEvidencePrecedent_workspaceId_normalizedTitleKey_idx" ON "ApprovedEvidencePrecedent"("workspaceId", "normalizedTitleKey");
CREATE INDEX "ApprovedEvidencePrecedent_workspaceId_normalizedOrganizerKey_idx" ON "ApprovedEvidencePrecedent"("workspaceId", "normalizedOrganizerKey");
CREATE INDEX "ApprovedEvidencePrecedent_workspaceId_eventYear_idx" ON "ApprovedEvidencePrecedent"("workspaceId", "eventYear");
CREATE INDEX "ApprovedEvidencePrecedent_sourceReviewTaskId_idx" ON "ApprovedEvidencePrecedent"("sourceReviewTaskId");
CREATE INDEX "ApprovedEvidencePrecedent_sourceResolutionCaseId_idx" ON "ApprovedEvidencePrecedent"("sourceResolutionCaseId");
CREATE INDEX "ApprovedEvidencePrecedent_previewFileId_idx" ON "ApprovedEvidencePrecedent"("previewFileId");

CREATE INDEX "EventRegistryAlias_normalizedAliasKey_trgm_idx" ON "EventRegistryAlias" USING GIN ("normalizedAliasKey" gin_trgm_ops);
CREATE INDEX "WorkspaceAbbreviation_normalizedTokenKey_trgm_idx" ON "WorkspaceAbbreviation" USING GIN ("normalizedTokenKey" gin_trgm_ops);
CREATE INDEX "ApprovedEvidencePrecedent_normalizedTitleKey_trgm_idx" ON "ApprovedEvidencePrecedent" USING GIN ("normalizedTitleKey" gin_trgm_ops);
CREATE INDEX "ApprovedEvidencePrecedent_normalizedOrganizerKey_trgm_idx" ON "ApprovedEvidencePrecedent" USING GIN ("normalizedOrganizerKey" gin_trgm_ops);
CREATE INDEX "ApprovedEvidencePrecedent_ocrSearchKey_trgm_idx" ON "ApprovedEvidencePrecedent" USING GIN ("ocrSearchKey" gin_trgm_ops);

ALTER TABLE "EventRegistryAlias" ADD CONSTRAINT "EventRegistryAlias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventRegistryAlias" ADD CONSTRAINT "EventRegistryAlias_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "EventRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceAbbreviation" ADD CONSTRAINT "WorkspaceAbbreviation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApprovedEvidencePrecedent" ADD CONSTRAINT "ApprovedEvidencePrecedent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovedEvidencePrecedent" ADD CONSTRAINT "ApprovedEvidencePrecedent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "EventRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovedEvidencePrecedent" ADD CONSTRAINT "ApprovedEvidencePrecedent_sourceEvidenceId_fkey" FOREIGN KEY ("sourceEvidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovedEvidencePrecedent" ADD CONSTRAINT "ApprovedEvidencePrecedent_sourceEvidenceCardId_fkey" FOREIGN KEY ("sourceEvidenceCardId") REFERENCES "EvidenceCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApprovedEvidencePrecedent" ADD CONSTRAINT "ApprovedEvidencePrecedent_sourceReviewTaskId_fkey" FOREIGN KEY ("sourceReviewTaskId") REFERENCES "ReviewTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApprovedEvidencePrecedent" ADD CONSTRAINT "ApprovedEvidencePrecedent_sourceResolutionCaseId_fkey" FOREIGN KEY ("sourceResolutionCaseId") REFERENCES "ResolutionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApprovedEvidencePrecedent" ADD CONSTRAINT "ApprovedEvidencePrecedent_previewFileId_fkey" FOREIGN KEY ("previewFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApprovedEvidencePrecedent" ADD CONSTRAINT "ApprovedEvidencePrecedent_criteriaVersionId_fkey" FOREIGN KEY ("criteriaVersionId") REFERENCES "CriteriaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
