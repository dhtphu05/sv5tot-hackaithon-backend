import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

const evidenceAnalysisJobInputSchema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceFileId: z.string().min(1),
    fileId: z.string().min(1),
  })
  .strict();

export type EvidenceAnalysisJobInput = z.infer<typeof evidenceAnalysisJobInputSchema>;

export function buildEvidenceAnalysisJobInput(input: EvidenceAnalysisJobInput): EvidenceAnalysisJobInput {
  return evidenceAnalysisJobInputSchema.parse(input);
}

export function parseEvidenceAnalysisJobInput(value: unknown): EvidenceAnalysisJobInput {
  const parsed = evidenceAnalysisJobInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Evidence analysis job is missing file binding', {
      retryable: false,
    });
  }
  return parsed.data;
}

export function isStaleEvidenceAnalysisJob(
  jobInput: Pick<EvidenceAnalysisJobInput, 'evidenceFileId' | 'fileId'>,
  currentFile: Pick<EvidenceAnalysisJobInput, 'evidenceFileId' | 'fileId'> | null,
) {
  if (!currentFile) return true;
  return jobInput.evidenceFileId !== currentFile.evidenceFileId || jobInput.fileId !== currentFile.fileId;
}
