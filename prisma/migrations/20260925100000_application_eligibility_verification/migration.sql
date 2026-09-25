-- CreateEnum
CREATE TYPE "ApplicationEligibilityVerificationDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ApplicationEligibilityVerification" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "decision" "ApplicationEligibilityVerificationDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationEligibilityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationEligibilityVerification_applicationId_key" ON "ApplicationEligibilityVerification"("applicationId");

-- CreateIndex
CREATE INDEX "ApplicationEligibilityVerification_decidedById_idx" ON "ApplicationEligibilityVerification"("decidedById");

-- AddForeignKey
ALTER TABLE "ApplicationEligibilityVerification" ADD CONSTRAINT "ApplicationEligibilityVerification_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEligibilityVerification" ADD CONSTRAINT "ApplicationEligibilityVerification_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
