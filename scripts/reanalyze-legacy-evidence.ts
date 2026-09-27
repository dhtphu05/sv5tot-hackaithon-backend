import { EvidenceSourceType, JobStatus, JobType } from '@prisma/client';
import { env } from '../src/config/env';
import { prisma } from '../src/infrastructure/database/prisma';
import { shouldReanalyseLegacyEvidence } from '../src/modules/evidences/evidence-reanalysis';
import { buildEvidenceAnalysisJobInput } from '../src/modules/jobs/evidence-analysis-job-input';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const includeConfirmed = args.has('--include-confirmed');
const limit = readNumberArg('--limit') ?? (apply ? 25 : 250);
const providerConfigured = Boolean(env.OPENAI_API_KEY && env.OPENAI_EVIDENCE_MODEL);

async function main() {
  const evidences = await prisma.evidence.findMany({
    where: { sourceType: EvidenceSourceType.manual_upload },
    take: limit,
    orderBy: { updatedAt: 'desc' },
    include: {
      evidenceCard: true,
      application: { select: { workspaceId: true } },
      evidenceFiles: { include: { file: true } },
    },
  });
  const reasonCounts = new Map<string, number>();
  let scanned = 0;
  let required = 0;
  let queued = 0;
  let skipped = 0;

  for (const evidence of evidences) {
    scanned += 1;
    const activeFile = resolveNewestEvidenceFile(evidence.evidenceFiles);
    const activeJobs = await prisma.indexingJob.findMany({
      where: {
        targetId: evidence.id,
        jobType: JobType.evidence_ocr,
        status: { in: [JobStatus.queued, JobStatus.processing] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const decision = shouldReanalyseLegacyEvidence({
      evidence,
      activeFile,
      evidenceCard: evidence.evidenceCard,
      activeJobs,
      providerConfigured,
      allowConfirmed: includeConfirmed,
    });
    if (!decision.required) {
      skipped += 1;
      continue;
    }
    required += 1;
    for (const reason of decision.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    if (!apply || !decision.safeToAutoQueue || !activeFile) continue;
    const existing = activeJobs.find((job) => {
      const input = asRecord(job.inputJson);
      return input?.evidenceFileId === activeFile.evidenceFileId && input?.fileId === activeFile.fileId;
    });
    if (existing) continue;
    await prisma.indexingJob.create({
      data: {
        targetId: evidence.id,
        workspaceId: evidence.application?.workspaceId,
        jobType: JobType.evidence_ocr,
        status: JobStatus.queued,
        attempts: 0,
        inputJson: buildEvidenceAnalysisJobInput({
          evidenceId: evidence.id,
          evidenceFileId: activeFile.evidenceFileId,
          fileId: activeFile.fileId,
          provider: 'openai',
          trigger: 'maintenance_reanalysis',
        }),
      },
    });
    queued += 1;
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        scanned,
        required,
        queued,
        skipped,
        providerConfigured,
        includeConfirmed,
        reasonCounts: Object.fromEntries([...reasonCounts.entries()].sort()),
      },
      null,
      2,
    ),
  );
}

function readNumberArg(name: string) {
  const value = process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function resolveNewestEvidenceFile(
  evidenceFiles: Array<{ id: string; fileId: string; file: { createdAt: Date; id: string } }>,
) {
  const newest = [...evidenceFiles].sort((left, right) => {
    const createdDiff = right.file.createdAt.getTime() - left.file.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    const fileIdDiff = right.file.id.localeCompare(left.file.id);
    if (fileIdDiff !== 0) return fileIdDiff;
    return right.id.localeCompare(left.id);
  })[0];
  return newest
    ? {
        evidenceFileId: newest.id,
        fileId: newest.fileId,
        createdAt: newest.file.createdAt,
      }
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unknown reanalysis script failure');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
