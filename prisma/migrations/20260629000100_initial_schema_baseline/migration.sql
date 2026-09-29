-- Baseline snapshot generated from prisma/schema.prisma at e46f1ac (pre-migration schema).
-- Existing databases with later migration history must mark this baseline applied once before deploy.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('student', 'class_representative', 'officer', 'manager', 'committee', 'admin');

-- CreateEnum
CREATE TYPE "Criterion" AS ENUM ('ethics', 'academic', 'physical', 'volunteer', 'integration', 'priority', 'collective');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('school', 'university', 'city', 'central');

-- CreateEnum
CREATE TYPE "ApplicationType" AS ENUM ('individual', 'collective');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('not_started', 'draft', 'prechecked', 'ready_to_submit', 'submitted', 'supplement_required', 'under_review', 'resolution_needed', 'completed', 'rejected');

-- CreateEnum
CREATE TYPE "FinalStatus" AS ENUM ('pending', 'passed', 'failed', 'partially_passed');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('metric_input', 'event_import', 'manual_upload', 'collective_import');

-- CreateEnum
CREATE TYPE "IndexingStatus" AS ENUM ('not_started', 'uploaded', 'pending_indexing', 'ocr_processing', 'extracting', 'checking_registry', 'indexed', 'failed', 'needs_manual_review');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('draft', 'pending_indexing', 'indexed', 'needs_supplement', 'under_review', 'accepted', 'rejected', 'resolution_needed');

-- CreateEnum
CREATE TYPE "ReviewTaskStatus" AS ENUM ('waiting', 'reviewing', 'supplement_required', 'accepted', 'rejected', 'resolution_needed');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('accepted', 'rejected', 'supplement_required', 'resolution_needed');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('evidence_ocr', 'event_roster_indexing', 'evidence_card_generation', 'smartreader_extract');

-- CreateEnum
CREATE TYPE "FileStorageType" AS ENUM ('local', 's3', 'r2');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('system', 'deadline', 'supplement_required', 'precheck_completed', 'review_updated', 'result_available');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('open', 'in_review', 'resolved', 'rejected');

-- CreateEnum
CREATE TYPE "KnowledgeDecision" AS ENUM ('accepted', 'rejected', 'needs_supplement', 'reference_only');

-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('gpa', 'conduct_score', 'physical_score', 'volunteer_days', 'foreign_language_score');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('unverified', 'pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "CollectiveStatus" AS ENUM ('draft', 'prechecked', 'ready_to_submit', 'submitted', 'supplement_required', 'under_review', 'resolution_needed', 'completed', 'rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'student',
    "studentCode" TEXT,
    "className" TEXT,
    "faculty" TEXT,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficerSpecialization" (
    "id" UUID NOT NULL,
    "officerId" UUID NOT NULL,
    "criterion" "Criterion" NOT NULL,
    "facultyScope" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficerSpecialization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "applicationType" "ApplicationType" NOT NULL,
    "targetLevel" "Level" NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'draft',
    "readinessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentDraftVersion" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "finalLevel" "Level",
    "finalStatus" "FinalStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDraftSnapshot" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDraftSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationMetric" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "metricType" "MetricType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "scale" DOUBLE PRECISION,
    "evidenceFileId" UUID,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'unverified',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "storageType" "FileStorageType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "publicUrl" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "applicationId" UUID,
    "collectiveProfileId" UUID,
    "evidenceName" TEXT NOT NULL,
    "criterion" "Criterion" NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "eventId" UUID,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'draft',
    "indexingStatus" "IndexingStatus" NOT NULL DEFAULT 'not_started',
    "confidence" DOUBLE PRECISION,
    "assignedOfficerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceFile" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "fileRole" TEXT,

    CONSTRAINT "EvidenceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceCard" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "ocrText" TEXT,
    "extractedFieldsJson" JSONB,
    "warningsJson" JSONB,
    "matchedEventId" UUID,
    "matchedKnowledgeItemIds" JSONB,
    "confidence" DOUBLE PRECISION,
    "aiSummary" TEXT,
    "rawAiResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistry" (
    "id" UUID NOT NULL,
    "eventName" TEXT NOT NULL,
    "criterion" "Criterion" NOT NULL,
    "organizer" TEXT NOT NULL,
    "organizerLevel" "Level" NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "convertedValue" DOUBLE PRECISION,
    "convertedUnit" TEXT,
    "eligibleLevelsJson" JSONB,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "rosterIndexed" BOOLEAN NOT NULL DEFAULT false,
    "sampleCertificateFileId" UUID,
    "status" "EventStatus" NOT NULL DEFAULT 'draft',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventFile" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "indexingStatus" "IndexingStatus" NOT NULL DEFAULT 'uploaded',
    "columnMappingJson" JSONB,
    "indexQualityScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "studentCode" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "className" TEXT,
    "faculty" TEXT,
    "participationStatus" TEXT,
    "indexedRow" INTEGER,
    "convertedValue" DOUBLE PRECISION,
    "sourceFileId" UUID,

    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBaseItem" (
    "id" UUID NOT NULL,
    "evidenceName" TEXT,
    "eventName" TEXT,
    "criterion" "Criterion" NOT NULL,
    "level" "Level",
    "decision" "KnowledgeDecision" NOT NULL,
    "reason" TEXT,
    "sampleCertificateFileId" UUID,
    "requiredFieldsJson" JSONB,
    "commonErrorsJson" JSONB,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriteriaVersion" (
    "id" UUID NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "unitScope" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "versionName" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriteriaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriteriaRule" (
    "id" UUID NOT NULL,
    "criteriaVersionId" UUID NOT NULL,
    "criterion" "Criterion" NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "thresholdJson" JSONB,
    "evidenceRequirementsJson" JSONB,
    "humanReadableText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriteriaRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrecheckResult" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "resultJson" JSONB NOT NULL,
    "readinessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "missingItemsJson" JSONB,
    "nextBestAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrecheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CascadeReview" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "targetLevel" "Level" NOT NULL,
    "suggestedLevel" "Level",
    "levelResultsJson" JSONB NOT NULL,
    "humanConfirmationRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CascadeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" UUID NOT NULL,
    "applicationId" UUID,
    "collectiveProfileId" UUID,
    "criterion" "Criterion" NOT NULL,
    "assignedOfficerId" UUID,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'waiting',
    "decision" "ReviewDecision",
    "officerNote" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTaskEvidence" (
    "reviewTaskId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,

    CONSTRAINT "ReviewTaskEvidence_pkey" PRIMARY KEY ("reviewTaskId","evidenceId")
);

-- CreateTable
CREATE TABLE "ResolutionCase" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "evidenceId" UUID,
    "reason" TEXT NOT NULL,
    "status" "ResolutionStatus" NOT NULL DEFAULT 'open',
    "committeeDecision" TEXT,
    "createdBy" UUID NOT NULL,
    "closedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ResolutionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexingJob" (
    "id" UUID NOT NULL,
    "jobType" "JobType" NOT NULL,
    "targetId" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "applicationId" UUID,
    "collectiveProfileId" UUID,
    "beforeStateJson" JSONB,
    "afterStateJson" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "applicationId" UUID,
    "collectiveProfileId" UUID,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectiveProfile" (
    "id" UUID NOT NULL,
    "representativeId" UUID NOT NULL,
    "className" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "targetLevel" "Level" NOT NULL,
    "status" "CollectiveStatus" NOT NULL DEFAULT 'draft',
    "readinessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "finalLevel" "Level",
    "finalStatus" "FinalStatus" NOT NULL DEFAULT 'pending',
    "finalNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectiveProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectiveMember" (
    "id" UUID NOT NULL,
    "collectiveProfileId" UUID NOT NULL,
    "studentCode" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "className" TEXT,
    "faculty" TEXT,
    "participationStatus" TEXT,
    "individualSv5tLevel" TEXT,
    "violationStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectiveMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectiveEvidence" (
    "id" UUID NOT NULL,
    "collectiveProfileId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "collectiveCriterion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectiveEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectivePrecheckResult" (
    "id" UUID NOT NULL,
    "collectiveProfileId" UUID NOT NULL,
    "resultJson" JSONB NOT NULL,
    "readinessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "missingItemsJson" JSONB,
    "nextBestAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectivePrecheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_studentCode_key" ON "User"("studentCode");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_faculty_idx" ON "User"("faculty");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "OfficerSpecialization_criterion_idx" ON "OfficerSpecialization"("criterion");

-- CreateIndex
CREATE UNIQUE INDEX "OfficerSpecialization_officerId_criterion_facultyScope_key" ON "OfficerSpecialization"("officerId", "criterion", "facultyScope");

-- CreateIndex
CREATE INDEX "Application_status_targetLevel_idx" ON "Application"("status", "targetLevel");

-- CreateIndex
CREATE INDEX "Application_studentId_schoolYear_idx" ON "Application"("studentId", "schoolYear");

-- CreateIndex
CREATE UNIQUE INDEX "Application_studentId_schoolYear_applicationType_key" ON "Application"("studentId", "schoolYear", "applicationType");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationDraftSnapshot_applicationId_version_key" ON "ApplicationDraftSnapshot"("applicationId", "version");

-- CreateIndex
CREATE INDEX "ApplicationMetric_verificationStatus_idx" ON "ApplicationMetric"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationMetric_applicationId_metricType_key" ON "ApplicationMetric"("applicationId", "metricType");

-- CreateIndex
CREATE INDEX "File_ownerId_idx" ON "File"("ownerId");

-- CreateIndex
CREATE INDEX "File_uploadedBy_idx" ON "File"("uploadedBy");

-- CreateIndex
CREATE INDEX "Evidence_applicationId_criterion_idx" ON "Evidence"("applicationId", "criterion");

-- CreateIndex
CREATE INDEX "Evidence_collectiveProfileId_criterion_idx" ON "Evidence"("collectiveProfileId", "criterion");

-- CreateIndex
CREATE INDEX "Evidence_evidenceName_idx" ON "Evidence"("evidenceName");

-- CreateIndex
CREATE INDEX "Evidence_indexingStatus_idx" ON "Evidence"("indexingStatus");

-- CreateIndex
CREATE INDEX "Evidence_assignedOfficerId_idx" ON "Evidence"("assignedOfficerId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceFile_evidenceId_fileId_key" ON "EvidenceFile"("evidenceId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceCard_evidenceId_key" ON "EvidenceCard"("evidenceId");

-- CreateIndex
CREATE INDEX "EventRegistry_criterion_idx" ON "EventRegistry"("criterion");

-- CreateIndex
CREATE INDEX "EventRegistry_status_idx" ON "EventRegistry"("status");

-- CreateIndex
CREATE INDEX "EventRegistry_eventName_idx" ON "EventRegistry"("eventName");

-- CreateIndex
CREATE UNIQUE INDEX "EventFile_eventId_fileId_key" ON "EventFile"("eventId", "fileId");

-- CreateIndex
CREATE INDEX "EventParticipant_studentCode_idx" ON "EventParticipant"("studentCode");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipant_eventId_studentCode_key" ON "EventParticipant"("eventId", "studentCode");

-- CreateIndex
CREATE INDEX "KnowledgeBaseItem_criterion_level_idx" ON "KnowledgeBaseItem"("criterion", "level");

-- CreateIndex
CREATE INDEX "KnowledgeBaseItem_evidenceName_idx" ON "KnowledgeBaseItem"("evidenceName");

-- CreateIndex
CREATE INDEX "KnowledgeBaseItem_eventName_idx" ON "KnowledgeBaseItem"("eventName");

-- CreateIndex
CREATE INDEX "CriteriaVersion_level_isActive_idx" ON "CriteriaVersion"("level", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CriteriaVersion_schoolYear_unitScope_level_versionName_key" ON "CriteriaVersion"("schoolYear", "unitScope", "level", "versionName");

-- CreateIndex
CREATE INDEX "CriteriaRule_criterion_idx" ON "CriteriaRule"("criterion");

-- CreateIndex
CREATE UNIQUE INDEX "CriteriaRule_criteriaVersionId_ruleKey_key" ON "CriteriaRule"("criteriaVersionId", "ruleKey");

-- CreateIndex
CREATE INDEX "PrecheckResult_applicationId_createdAt_idx" ON "PrecheckResult"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "CascadeReview_applicationId_createdAt_idx" ON "CascadeReview"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewTask_assignedOfficerId_status_idx" ON "ReviewTask"("assignedOfficerId", "status");

-- CreateIndex
CREATE INDEX "ReviewTask_applicationId_criterion_idx" ON "ReviewTask"("applicationId", "criterion");

-- CreateIndex
CREATE INDEX "ReviewTask_collectiveProfileId_criterion_idx" ON "ReviewTask"("collectiveProfileId", "criterion");

-- CreateIndex
CREATE INDEX "ResolutionCase_status_idx" ON "ResolutionCase"("status");

-- CreateIndex
CREATE INDEX "ResolutionCase_applicationId_idx" ON "ResolutionCase"("applicationId");

-- CreateIndex
CREATE INDEX "IndexingJob_jobType_status_idx" ON "IndexingJob"("jobType", "status");

-- CreateIndex
CREATE INDEX "IndexingJob_targetId_idx" ON "IndexingJob"("targetId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_applicationId_idx" ON "AuditLog"("applicationId");

-- CreateIndex
CREATE INDEX "AuditLog_collectiveProfileId_idx" ON "AuditLog"("collectiveProfileId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_applicationId_idx" ON "Notification"("applicationId");

-- CreateIndex
CREATE INDEX "Notification_collectiveProfileId_idx" ON "Notification"("collectiveProfileId");

-- CreateIndex
CREATE INDEX "CollectiveProfile_status_targetLevel_idx" ON "CollectiveProfile"("status", "targetLevel");

-- CreateIndex
CREATE UNIQUE INDEX "CollectiveProfile_representativeId_schoolYear_className_key" ON "CollectiveProfile"("representativeId", "schoolYear", "className");

-- CreateIndex
CREATE UNIQUE INDEX "CollectiveMember_collectiveProfileId_studentCode_key" ON "CollectiveMember"("collectiveProfileId", "studentCode");

-- CreateIndex
CREATE UNIQUE INDEX "CollectiveEvidence_collectiveProfileId_evidenceId_key" ON "CollectiveEvidence"("collectiveProfileId", "evidenceId");

-- CreateIndex
CREATE INDEX "CollectivePrecheckResult_collectiveProfileId_createdAt_idx" ON "CollectivePrecheckResult"("collectiveProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerSpecialization" ADD CONSTRAINT "OfficerSpecialization_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDraftSnapshot" ADD CONSTRAINT "ApplicationDraftSnapshot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMetric" ADD CONSTRAINT "ApplicationMetric_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_collectiveProfileId_fkey" FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "EventRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceCard" ADD CONSTRAINT "EvidenceCard_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistry" ADD CONSTRAINT "EventRegistry_sampleCertificateFileId_fkey" FOREIGN KEY ("sampleCertificateFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFile" ADD CONSTRAINT "EventFile_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "EventRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFile" ADD CONSTRAINT "EventFile_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "EventRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseItem" ADD CONSTRAINT "KnowledgeBaseItem_sampleCertificateFileId_fkey" FOREIGN KEY ("sampleCertificateFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriteriaRule" ADD CONSTRAINT "CriteriaRule_criteriaVersionId_fkey" FOREIGN KEY ("criteriaVersionId") REFERENCES "CriteriaVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecheckResult" ADD CONSTRAINT "PrecheckResult_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CascadeReview" ADD CONSTRAINT "CascadeReview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_collectiveProfileId_fkey" FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTaskEvidence" ADD CONSTRAINT "ReviewTaskEvidence_reviewTaskId_fkey" FOREIGN KEY ("reviewTaskId") REFERENCES "ReviewTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTaskEvidence" ADD CONSTRAINT "ReviewTaskEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionCase" ADD CONSTRAINT "ResolutionCase_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionCase" ADD CONSTRAINT "ResolutionCase_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_collectiveProfileId_fkey" FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_collectiveProfileId_fkey" FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectiveProfile" ADD CONSTRAINT "CollectiveProfile_representativeId_fkey" FOREIGN KEY ("representativeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectiveMember" ADD CONSTRAINT "CollectiveMember_collectiveProfileId_fkey" FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectiveEvidence" ADD CONSTRAINT "CollectiveEvidence_collectiveProfileId_fkey" FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectiveEvidence" ADD CONSTRAINT "CollectiveEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectivePrecheckResult" ADD CONSTRAINT "CollectivePrecheckResult_collectiveProfileId_fkey" FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
