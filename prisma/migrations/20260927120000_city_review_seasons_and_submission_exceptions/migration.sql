CREATE TABLE "CityReviewSeason" (
    "id" UUID NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "submissionOpensAt" TIMESTAMP(3),
    "submissionClosesAt" TIMESTAMP(3),
    "reviewDeadlineAt" TIMESTAMP(3),
    "supplementDeadlineAt" TIMESTAMP(3),
    "finalizationDeadlineAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CityReviewSeason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CityReviewSeason_schoolYear_key" ON "CityReviewSeason"("schoolYear");

CREATE TABLE "CitySubmissionWindowException" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedById" UUID NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CitySubmissionWindowException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CitySubmissionWindowException_applicationId_key" ON "CitySubmissionWindowException"("applicationId");
CREATE INDEX "CitySubmissionWindowException_validUntil_revokedAt_idx" ON "CitySubmissionWindowException"("validUntil", "revokedAt");

ALTER TABLE "CitySubmissionWindowException"
ADD CONSTRAINT "CitySubmissionWindowException_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CitySubmissionWindowException"
ADD CONSTRAINT "CitySubmissionWindowException_grantedById_fkey"
FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CitySubmissionWindowException"
ADD CONSTRAINT "CitySubmissionWindowException_revokedById_fkey"
FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
