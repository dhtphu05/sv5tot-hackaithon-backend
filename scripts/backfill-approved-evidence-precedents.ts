import 'dotenv/config';
import {
  ApprovedEvidenceApprovalSource,
  EvidenceStatus,
  ResolutionStatus,
  ReviewDecision,
  ReviewTaskStatus,
  type Prisma,
  type User,
} from '@prisma/client';
import { prisma } from '../src/infrastructure/database/prisma';
import { EvidenceKnowledgePublisher } from '../src/modules/evidence-knowledge/evidence-knowledge.publisher';
import type { AuthenticatedUser } from '../src/shared/types/auth';

type Args = {
  apply: boolean;
  workspaceCode?: string;
  limit?: number;
};

type Candidate = {
  evidenceId: string;
  evidenceName: string;
  approvalSource: ApprovedEvidenceApprovalSource;
  reviewTaskId: string | null;
  resolutionCaseId: string | null;
  actorId: string;
};

type Counts = {
  scannedAcceptedEvidence: number;
  skippedExistingPrecedent: number;
  skippedNoApplication: number;
  skippedNoApprovalSource: number;
  skippedNoActor: number;
  candidates: number;
  wouldPublish: number;
  published: number;
  publisherReturnedNull: number;
  failed: number;
};

const counts: Counts = {
  scannedAcceptedEvidence: 0,
  skippedExistingPrecedent: 0,
  skippedNoApplication: 0,
  skippedNoApprovalSource: 0,
  skippedNoActor: 0,
  candidates: 0,
  wouldPublish: 0,
  published: 0,
  publisherReturnedNull: 0,
  failed: 0,
};

const publisher = new EvidenceKnowledgePublisher();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const where: Prisma.EvidenceWhereInput = {
    status: EvidenceStatus.accepted,
    applicationId: { not: null },
    ...(args.workspaceCode ? { application: { workspace: { code: args.workspaceCode } } } : {}),
  };

  const evidences = await prisma.evidence.findMany({
    where,
    include: {
      application: { include: { workspace: true } },
      approvedEvidencePrecedents: { select: { id: true }, take: 1 },
      reviewTaskEvidences: {
        include: {
          reviewTask: {
            include: { assignedOfficer: true },
          },
        },
        orderBy: { reviewTask: { updatedAt: 'desc' } },
      },
      resolutionCases: {
        include: {
          reviewTask: { include: { assignedOfficer: true } },
          application: true,
        },
        orderBy: [{ closedAt: 'desc' }, { createdAt: 'desc' }],
      },
    },
    orderBy: { updatedAt: 'asc' },
    ...(args.limit ? { take: args.limit } : {}),
  });
  const actorIds = Array.from(
    new Set(
      evidences.flatMap((evidence) => [
        ...evidence.reviewTaskEvidences.map((link) => link.reviewTask.assignedOfficerId),
        ...evidence.resolutionCases.map((resolutionCase) => resolutionCase.closedBy),
        ...evidence.resolutionCases.map(
          (resolutionCase) => resolutionCase.reviewTask?.assignedOfficerId,
        ),
      ]),
    ),
  ).filter((id): id is string => Boolean(id));
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } } });
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  counts.scannedAcceptedEvidence = evidences.length;

  const preview: Array<Record<string, unknown>> = [];
  for (const evidence of evidences) {
    if (!evidence.application) {
      counts.skippedNoApplication += 1;
      continue;
    }
    if (evidence.approvedEvidencePrecedents.length > 0) {
      counts.skippedExistingPrecedent += 1;
      continue;
    }

    const candidate = resolveCandidate(evidence);
    if (!candidate) continue;
    const actor = actorById.get(candidate.actorId);
    if (!actor) {
      counts.skippedNoActor += 1;
      continue;
    }
    counts.candidates += 1;

    preview.push({
      evidenceId: candidate.evidenceId,
      evidenceName: candidate.evidenceName,
      approvalSource: candidate.approvalSource,
      reviewTaskId: candidate.reviewTaskId,
      resolutionCaseId: candidate.resolutionCaseId,
      actorEmail: actor.email,
    });

    if (!args.apply) {
      counts.wouldPublish += 1;
      continue;
    }

    try {
      const result = await prisma.$transaction((tx) =>
        publisher.publishAcceptedEvidence(tx, toAuthenticatedUser(actor), {
          evidenceId: candidate.evidenceId,
          reviewTaskId: candidate.reviewTaskId,
          resolutionCaseId: candidate.resolutionCaseId,
          approvalSource: candidate.approvalSource,
          note: 'Backfilled from historical accepted evidence.',
        }),
      );
      if (result) {
        counts.published += 1;
      } else {
        counts.publisherReturnedNull += 1;
      }
    } catch (error) {
      counts.failed += 1;
      console.error(
        JSON.stringify(
          {
            evidenceId: candidate.evidenceId,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        apply: args.apply,
        workspaceCode: args.workspaceCode ?? 'all',
        limit: args.limit ?? null,
        counts,
        preview: preview.slice(0, 20),
        nextCommand: args.apply ? null : buildApplyCommand(args),
      },
      null,
      2,
    ),
  );
}

function resolveCandidate(
  evidence: Prisma.EvidenceGetPayload<{
    include: {
      application: { include: { workspace: true } };
      approvedEvidencePrecedents: { select: { id: true }; take: 1 };
      reviewTaskEvidences: {
        include: { reviewTask: { include: { assignedOfficer: true } } };
        orderBy: { reviewTask: { updatedAt: 'desc' } };
      };
      resolutionCases: {
        include: {
          reviewTask: { include: { assignedOfficer: true } };
          application: true;
        };
        orderBy: Array<{ closedAt: 'desc' } | { createdAt: 'desc' }>;
      };
    };
  }>,
): Candidate | null {
  const acceptedResolution = evidence.resolutionCases.find((resolutionCase) =>
    isResolutionAcceptedForEvidence(resolutionCase, evidence.id),
  );
  if (acceptedResolution) {
    return candidateOrSkip({
      evidenceId: evidence.id,
      evidenceName: evidence.evidenceName,
      approvalSource: ApprovedEvidenceApprovalSource.resolution,
      reviewTaskId: acceptedResolution.reviewTaskId ?? null,
      resolutionCaseId: acceptedResolution.id,
      actorId:
        acceptedResolution.closedBy ?? acceptedResolution.reviewTask?.assignedOfficerId ?? null,
    });
  }

  const acceptedTask = evidence.reviewTaskEvidences
    .map((link) => link.reviewTask)
    .find(
      (task) =>
        task.status === ReviewTaskStatus.accepted || task.decision === ReviewDecision.accepted,
    );
  if (acceptedTask) {
    return candidateOrSkip({
      evidenceId: evidence.id,
      evidenceName: evidence.evidenceName,
      approvalSource: ApprovedEvidenceApprovalSource.officer,
      reviewTaskId: acceptedTask.id,
      resolutionCaseId: null,
      actorId: acceptedTask.assignedOfficerId,
    });
  }

  counts.skippedNoApprovalSource += 1;
  return null;
}

function candidateOrSkip(input: {
  evidenceId: string;
  evidenceName: string;
  approvalSource: ApprovedEvidenceApprovalSource;
  reviewTaskId: string | null;
  resolutionCaseId: string | null;
  actorId: string | null;
}): Candidate | null {
  if (input.actorId) {
    return { ...input, actorId: input.actorId };
  }
  counts.skippedNoActor += 1;
  return null;
}

function isResolutionAcceptedForEvidence(
  resolutionCase: {
    status: ResolutionStatus;
    committeeDecision: string | null;
    evidenceId: string | null;
  },
  evidenceId: string,
): boolean {
  if (resolutionCase.status !== ResolutionStatus.resolved) return false;
  if (resolutionCase.evidenceId && resolutionCase.evidenceId !== evidenceId) return false;
  const decision = parseCommitteeDecision(resolutionCase.committeeDecision);
  if (!decision) return false;
  if (decision.decision === 'accepted') return true;
  const evidenceDecisions = Array.isArray(decision.evidenceDecisions)
    ? decision.evidenceDecisions
    : [];
  return evidenceDecisions.some(
    (item) => isRecord(item) && item.evidenceId === evidenceId && item.decision === 'accepted',
  );
}

function parseCommitteeDecision(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    studentCode: user.studentCode,
    className: user.className,
    faculty: user.faculty,
    avatarUrl: user.avatarUrl,
    workspaceId: user.workspaceId,
    workspace: null,
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: process.env.BACKFILL_APPLY === 'true',
    workspaceCode: process.env.BACKFILL_WORKSPACE_CODE,
    limit: process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : undefined,
  };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    if (arg.startsWith('--code=')) args.workspaceCode = arg.split('=')[1];
    if (arg.startsWith('--workspace=')) args.workspaceCode = arg.split('=')[1];
    if (arg.startsWith('--workspaceCode=')) args.workspaceCode = arg.split('=')[1];
    if (arg.startsWith('--limit=')) args.limit = Number(arg.split('=')[1]);
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) {
    throw new Error('--limit must be a positive integer');
  }
  return args;
}

function buildApplyCommand(args: Args): string {
  return [
    'npx tsx scripts/backfill-approved-evidence-precedents.ts',
    args.workspaceCode ? `--code=${args.workspaceCode}` : '',
    args.limit ? `--limit=${args.limit}` : '',
    '--apply',
  ]
    .filter(Boolean)
    .join(' ');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
