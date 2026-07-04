ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'decision_metadata';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'decision_roster_ocr';

CREATE TYPE "DecisionImportStatus" AS ENUM (
  'draft',
  'uploaded',
  'extracting_metadata',
  'ocr_processing',
  'parsing_roster',
  'preview_ready',
  'confirmed',
  'failed',
  'cancelled'
);

CREATE TYPE "DecisionTableType" AS ENUM (
  'roster',
  'criteria',
  'signature',
  'unknown'
);

CREATE TYPE "RosterPreviewValidationStatus" AS ENUM (
  'valid',
  'warning',
  'invalid',
  'duplicate',
  'missing_student_code',
  'needs_manual_review'
);

CREATE TABLE "DecisionImport" (
  "id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "criterion" "Criterion",
  "eventName" TEXT,
  "organizer" TEXT,
  "organizerLevel" "Level",
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "convertedValue" DOUBLE PRECISION,
  "convertedUnit" TEXT,
  "eligibleLevelsJson" JSONB,
  "status" "DecisionImportStatus" NOT NULL DEFAULT 'draft',
  "sourceFileId" UUID,
  "vnptHash" TEXT,
  "vnptFileType" TEXT,
  "metadataJobId" UUID,
  "rosterJobId" UUID,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "confirmedBy" UUID,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "lastUserMessage" TEXT,
  "processingStep" TEXT,
  "columnMappingJson" JSONB,
  CONSTRAINT "DecisionImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionDocument" (
  "id" UUID NOT NULL,
  "decisionImportId" UUID NOT NULL,
  "documentNo" TEXT,
  "documentType" TEXT,
  "issuer" TEXT,
  "issueDate" TIMESTAMP(3),
  "effectiveDate" TIMESTAMP(3),
  "signer" TEXT,
  "summary" TEXT,
  "relatedDocumentsJson" JSONB,
  "rawAdminResponseJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionTable" (
  "id" UUID NOT NULL,
  "decisionImportId" UUID NOT NULL,
  "pageNumber" INTEGER,
  "tableIndex" INTEGER,
  "detectedType" "DecisionTableType" NOT NULL DEFAULT 'unknown',
  "headerJson" JSONB,
  "rowsCount" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION,
  "rawTableJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionTable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionRosterPreviewRow" (
  "id" UUID NOT NULL,
  "decisionImportId" UUID NOT NULL,
  "studentCode" TEXT,
  "studentName" TEXT,
  "className" TEXT,
  "faculty" TEXT,
  "criterion" "Criterion",
  "convertedValue" DOUBLE PRECISION,
  "convertedUnit" TEXT,
  "participationStatus" TEXT,
  "sourcePage" INTEGER,
  "sourceTableIndex" INTEGER,
  "sourceRowIndex" INTEGER,
  "validationStatus" "RosterPreviewValidationStatus" NOT NULL,
  "validationWarningsJson" JSONB,
  "rawRowJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionRosterPreviewRow_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EventRegistry"
ADD COLUMN "decisionDocumentId" UUID,
ADD COLUMN "sourceDecisionImportId" UUID,
ADD COLUMN "officialDocumentNo" TEXT,
ADD COLUMN "officialIssueDate" TIMESTAMP(3),
ADD COLUMN "officialSigner" TEXT,
ADD COLUMN "officialIssuer" TEXT;

ALTER TABLE "EventParticipant"
ADD COLUMN "sourceDecisionDocumentId" UUID,
ADD COLUMN "sourcePage" INTEGER,
ADD COLUMN "sourceTableIndex" INTEGER,
ADD COLUMN "sourceRowIndex" INTEGER,
ADD COLUMN "ocrConfidence" DOUBLE PRECISION,
ADD COLUMN "normalizedConfidence" DOUBLE PRECISION,
ADD COLUMN "rawRowJson" JSONB;

CREATE INDEX "DecisionImport_status_idx" ON "DecisionImport"("status");
CREATE INDEX "DecisionImport_sourceFileId_idx" ON "DecisionImport"("sourceFileId");
CREATE INDEX "DecisionImport_createdBy_idx" ON "DecisionImport"("createdBy");
CREATE INDEX "DecisionImport_metadataJobId_idx" ON "DecisionImport"("metadataJobId");
CREATE INDEX "DecisionImport_rosterJobId_idx" ON "DecisionImport"("rosterJobId");
CREATE UNIQUE INDEX "DecisionDocument_decisionImportId_key" ON "DecisionDocument"("decisionImportId");
CREATE INDEX "DecisionDocument_documentNo_idx" ON "DecisionDocument"("documentNo");
CREATE INDEX "DecisionTable_decisionImportId_idx" ON "DecisionTable"("decisionImportId");
CREATE INDEX "DecisionTable_detectedType_idx" ON "DecisionTable"("detectedType");
CREATE INDEX "DecisionRosterPreviewRow_decisionImportId_idx" ON "DecisionRosterPreviewRow"("decisionImportId");
CREATE INDEX "DecisionRosterPreviewRow_studentCode_idx" ON "DecisionRosterPreviewRow"("studentCode");
CREATE INDEX "DecisionRosterPreviewRow_validationStatus_idx" ON "DecisionRosterPreviewRow"("validationStatus");
CREATE INDEX "EventRegistry_decisionDocumentId_idx" ON "EventRegistry"("decisionDocumentId");
CREATE INDEX "EventRegistry_sourceDecisionImportId_idx" ON "EventRegistry"("sourceDecisionImportId");
CREATE INDEX "EventParticipant_sourceDecisionDocumentId_idx" ON "EventParticipant"("sourceDecisionDocumentId");

ALTER TABLE "DecisionImport"
ADD CONSTRAINT "DecisionImport_sourceFileId_fkey"
FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DecisionImport"
ADD CONSTRAINT "DecisionImport_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DecisionImport"
ADD CONSTRAINT "DecisionImport_confirmedBy_fkey"
FOREIGN KEY ("confirmedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DecisionDocument"
ADD CONSTRAINT "DecisionDocument_decisionImportId_fkey"
FOREIGN KEY ("decisionImportId") REFERENCES "DecisionImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DecisionTable"
ADD CONSTRAINT "DecisionTable_decisionImportId_fkey"
FOREIGN KEY ("decisionImportId") REFERENCES "DecisionImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DecisionRosterPreviewRow"
ADD CONSTRAINT "DecisionRosterPreviewRow_decisionImportId_fkey"
FOREIGN KEY ("decisionImportId") REFERENCES "DecisionImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventRegistry"
ADD CONSTRAINT "EventRegistry_decisionDocumentId_fkey"
FOREIGN KEY ("decisionDocumentId") REFERENCES "DecisionDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventRegistry"
ADD CONSTRAINT "EventRegistry_sourceDecisionImportId_fkey"
FOREIGN KEY ("sourceDecisionImportId") REFERENCES "DecisionImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventParticipant"
ADD CONSTRAINT "EventParticipant_sourceDecisionDocumentId_fkey"
FOREIGN KEY ("sourceDecisionDocumentId") REFERENCES "DecisionDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
