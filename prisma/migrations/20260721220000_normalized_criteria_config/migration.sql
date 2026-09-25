-- Additive current criteria configuration tables. These do not replace legacy
-- CriteriaVersion/CriteriaRule tables, which remain for backward compatibility.

CREATE TABLE "CriteriaConfig" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" "Level" NOT NULL,
    "workspaceId" UUID,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceDocumentName" TEXT NOT NULL,
    "sourceDocumentNumber" TEXT,
    "sourceIssuedAt" TIMESTAMP(3),
    "sourcePeriodLabel" TEXT,
    "sourceOrganization" TEXT NOT NULL,
    "sourceFileName" TEXT,
    "sourceNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriteriaConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NormalizedCriteriaRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "criteriaConfigId" UUID NOT NULL,
    "criterion" "Criterion" NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requirementJson" JSONB NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "priorityRule" BOOLEAN NOT NULL DEFAULT false,
    "studentFriendlyText" TEXT NOT NULL,
    "officerFriendlyText" TEXT,
    "acceptedEvidenceHintsJson" JSONB,
    "missingActionHintsJson" JSONB,
    "sourcePage" INTEGER,
    "sourceSection" TEXT,
    "sourceQuote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizedCriteriaRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CriteriaConfig_code_key" ON "CriteriaConfig"("code");
CREATE INDEX "CriteriaConfig_scope_workspaceId_isActive_idx" ON "CriteriaConfig"("scope", "workspaceId", "isActive");
CREATE INDEX "CriteriaConfig_isActive_idx" ON "CriteriaConfig"("isActive");
CREATE UNIQUE INDEX "CriteriaConfig_active_workspace_unique"
ON "CriteriaConfig"("scope", "workspaceId")
WHERE "isActive" = true AND "workspaceId" IS NOT NULL;
CREATE UNIQUE INDEX "CriteriaConfig_active_global_unique"
ON "CriteriaConfig"("scope")
WHERE "isActive" = true AND "workspaceId" IS NULL;

CREATE UNIQUE INDEX "NormalizedCriteriaRule_criteriaConfigId_ruleKey_key"
ON "NormalizedCriteriaRule"("criteriaConfigId", "ruleKey");
CREATE INDEX "NormalizedCriteriaRule_criteriaConfigId_criterion_isActive_idx"
ON "NormalizedCriteriaRule"("criteriaConfigId", "criterion", "isActive");
CREATE INDEX "NormalizedCriteriaRule_criteriaConfigId_mandatory_priorityRule_isActive_idx"
ON "NormalizedCriteriaRule"("criteriaConfigId", "mandatory", "priorityRule", "isActive");

ALTER TABLE "CriteriaConfig"
ADD CONSTRAINT "CriteriaConfig_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NormalizedCriteriaRule"
ADD CONSTRAINT "NormalizedCriteriaRule_criteriaConfigId_fkey"
FOREIGN KEY ("criteriaConfigId") REFERENCES "CriteriaConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
