import { DecisionImportStatus, type IndexingJob, type Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export async function assertDecisionJobIsCurrent(
  tx: Prisma.TransactionClient,
  job: IndexingJob,
  sourceFileId: string,
  jobPointer: 'metadataJobId' | 'rosterJobId',
) {
  const current = await tx.decisionImport.findUnique({
    where: { id: job.targetId },
    select: {
      workspaceId: true,
      sourceFileId: true,
      status: true,
      metadataJobId: true,
      rosterJobId: true,
    },
  });
  if (
    !current ||
    current.workspaceId !== job.workspaceId ||
    current.sourceFileId !== sourceFileId ||
    current[jobPointer] !== job.id ||
    current.status === DecisionImportStatus.confirmed ||
    current.status === DecisionImportStatus.cancelled
  ) {
    throw new AppError(409, ErrorCodes.CONFLICT, 'Decision extraction job is no longer current');
  }
}
