import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

const evidenceAnalysisJobInputSchema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceFileId: z.string().min(1),
    fileId: z.string().min(1),
    provider: z.enum(['openai', 'smartreader', 'mock']).optional(),
    trigger: z
      .enum(['manual_upload', 'manual_retry', 'student_assistant_reanalysis', 'maintenance_reanalysis'])
      .optional(),
  })
  .strict();

export type EvidenceAnalysisJobInput = z.infer<typeof evidenceAnalysisJobInputSchema>;
export type EvidenceAnalysisJobFileLink = {
  id: string;
  fileId: string;
  file?: { createdAt?: Date } | null;
};

export function buildEvidenceAnalysisJobInput(input: EvidenceAnalysisJobInput): EvidenceAnalysisJobInput {
  return evidenceAnalysisJobInputSchema.parse(input);
}

export function parseEvidenceAnalysisJobInput(value: unknown): EvidenceAnalysisJobInput {
  const parsed = evidenceAnalysisJobInputSchema.safeParse(normalizeJobInputValue(value));
  if (!parsed.success) {
    throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Evidence analysis job is missing file binding', {
      retryable: false,
    });
  }
  return parsed.data;
}

export function recoverEvidenceAnalysisJobInputFromCurrentFile(
  evidenceId: string,
  evidenceFiles: EvidenceAnalysisJobFileLink[],
): EvidenceAnalysisJobInput | null {
  if (evidenceFiles.length !== 1) return null;
  const [link] = evidenceFiles;
  if (!link) return null;
  return buildEvidenceAnalysisJobInput({
    evidenceId,
    evidenceFileId: link.id,
    fileId: link.fileId,
    provider: 'openai',
    trigger: 'manual_retry',
  });
}

export function isStaleEvidenceAnalysisJob(
  jobInput: Pick<EvidenceAnalysisJobInput, 'evidenceFileId' | 'fileId'>,
  currentFile: Pick<EvidenceAnalysisJobInput, 'evidenceFileId' | 'fileId'> | null,
) {
  if (!currentFile) return true;
  return jobInput.evidenceFileId !== currentFile.evidenceFileId || jobInput.fileId !== currentFile.fileId;
}

function normalizeJobInputValue(value: unknown): unknown {
  const decoded = typeof value === 'string' ? parseJsonObject(value) : value;
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return decoded;
  const record = decoded as Record<string, unknown>;
  return {
    evidenceId: record.evidenceId ?? record.evidence_id,
    evidenceFileId: record.evidenceFileId ?? record.evidence_file_id,
    fileId: record.fileId ?? record.file_id,
    provider: record.provider,
    trigger: record.trigger,
  };
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
