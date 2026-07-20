import 'dotenv/config';
import {
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  MetricType,
  Prisma,
  PrismaClient,
  RequirementResponseKind,
  RequirementResponseStatus,
  VerificationStatus,
  type ApplicationMetric,
  type Evidence,
  type EvidenceCard,
  type EventRegistry,
} from '@prisma/client';

const prisma = new PrismaClient();

type Args = {
  dryRun: boolean;
  workspaceCode?: string;
};

type Counts = {
  metricResponsesCreated: number;
  evidenceResponsesCreated: number;
  eventResponsesCreated: number;
  volunteerLegacySummariesCreated: number;
  workspaceResponsesFixed: number;
  fileWorkspaceFixed: number;
  skippedExisting: number;
  skippedNoApplication: number;
  skippedCrossWorkspace: number;
  unclassifiedEvidence: number;
};

const counts: Counts = {
  metricResponsesCreated: 0,
  evidenceResponsesCreated: 0,
  eventResponsesCreated: 0,
  volunteerLegacySummariesCreated: 0,
  workspaceResponsesFixed: 0,
  fileWorkspaceFixed: 0,
  skippedExisting: 0,
  skippedNoApplication: 0,
  skippedCrossWorkspace: 0,
  unclassifiedEvidence: 0,
};

const metricRequirementMap: Record<MetricType, { criterion: Criterion; requirementKey: string }> = {
  [MetricType.gpa]: { criterion: Criterion.academic, requirementKey: 'academic_gpa' },
  [MetricType.conduct_score]: { criterion: Criterion.ethics, requirementKey: 'conduct_score' },
  [MetricType.physical_score]: {
    criterion: Criterion.physical,
    requirementKey: 'physical_course_result',
  },
  [MetricType.volunteer_days]: {
    criterion: Criterion.volunteer,
    requirementKey: 'accumulated_volunteer_days',
  },
  [MetricType.foreign_language_score]: {
    criterion: Criterion.integration,
    requirementKey: 'foreign_language',
  },
};

const knownEvidenceRequirementKeys = new Set([
  'political_theory_competition',
  'exemplary_youth',
  'good_person_good_deed',
  'recognized_courageous_action',
  'other_ethics_achievement',
  'student_research',
  'academic_competition',
  'journal_article',
  'conference_paper',
  'thesis_or_capstone',
  'innovation_product',
  'academic_team',
  'academic_award',
  'other_academic_achievement',
  'healthy_student_title',
  'sports_activity_or_award',
  'sports_team_member',
  'regular_sports_training',
  'recognized_campaign',
  'volunteer_award',
  'foreign_language',
  'skills_or_union_training',
  'international_exchange',
  'foreign_language_or_integration_competition',
  'student_union_achievement',
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const where = args.workspaceCode
    ? { workspace: { code: args.workspaceCode } }
    : {};

  await backfillMetrics(where, args);
  await backfillEvidence(where, args);
  await fixResponseWorkspace(where, args);
  await fixFileWorkspace(args);

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        workspaceCode: args.workspaceCode ?? 'all-local',
        counts,
      },
      null,
      2,
    ),
  );
}

async function backfillMetrics(where: Prisma.ApplicationWhereInput, args: Args) {
  const metrics = await prisma.applicationMetric.findMany({
    where: { application: where },
    include: { application: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const metric of metrics) {
    const target = metricRequirementMap[metric.metricType];
    if (!target) continue;
    if (metric.application.workspaceId !== await workspaceIdForApplication(metric.applicationId)) {
      counts.skippedCrossWorkspace += 1;
      continue;
    }
    const status =
      metric.metricType === MetricType.volunteer_days
        ? RequirementResponseStatus.needs_verification
        : statusFromMetric(metric.verificationStatus);
    const payload =
      metric.metricType === MetricType.volunteer_days
        ? {
            activityType: 'legacy_volunteer_days',
            declaredValue: metric.value,
            declaredUnit: 'day',
            convertedValue: null,
            convertedUnit: 'day',
            conversionSource: null,
            sourceType: 'legacy_metric',
            schoolYear: metric.schoolYear,
            note: 'Legacy volunteer total kept as needs_verification summary.',
          }
        : metricPayload(metric);

    const created = await createResponseOnce(
      {
        workspaceId: metric.application.workspaceId,
        applicationId: metric.applicationId,
        createdBy: metric.application.studentId,
        criterion: target.criterion,
        requirementKey: target.requirementKey,
        responseKind: RequirementResponseKind.metric,
        metricId: metric.id,
        evidenceId: null,
        status,
        payloadJson: payload,
      },
      args,
    );
    if (!created) continue;
    if (metric.metricType === MetricType.volunteer_days) {
      counts.volunteerLegacySummariesCreated += 1;
    } else {
      counts.metricResponsesCreated += 1;
    }
  }
}

async function backfillEvidence(where: Prisma.ApplicationWhereInput, args: Args) {
  const evidences = await prisma.evidence.findMany({
    where: { application: where, applicationId: { not: null } },
    include: { application: true, evidenceCard: true, event: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const evidence of evidences) {
    if (!evidence.application) {
      counts.skippedNoApplication += 1;
      continue;
    }
    if (evidence.event && evidence.event.workspaceId !== evidence.application.workspaceId) {
      counts.skippedCrossWorkspace += 1;
      continue;
    }
    const target = inferEvidenceTarget(evidence);
    if (target.requirementKey === 'legacy_unclassified') counts.unclassifiedEvidence += 1;
    const isOfficialEvent = evidence.sourceType === EvidenceSourceType.event_import && Boolean(evidence.eventId);
    const created = await createResponseOnce(
      {
        workspaceId: evidence.application.workspaceId,
        applicationId: evidence.application.id,
        createdBy: evidence.application.studentId,
        criterion: target.criterion,
        requirementKey: target.requirementKey,
        responseKind: isOfficialEvent ? RequirementResponseKind.official_event : RequirementResponseKind.evidence,
        metricId: null,
        evidenceId: evidence.id,
        status: statusFromEvidence(evidence),
        payloadJson: evidencePayload(evidence, target.requirementKey),
      },
      args,
    );
    if (!created) continue;
    if (isOfficialEvent) {
      counts.eventResponsesCreated += 1;
    } else {
      counts.evidenceResponsesCreated += 1;
    }
  }
}

async function fixResponseWorkspace(where: Prisma.ApplicationWhereInput, args: Args) {
  const responses = await prisma.applicationRequirementResponse.findMany({
    where: { application: where },
    include: { application: true },
  });
  for (const response of responses) {
    if (response.workspaceId === response.application.workspaceId) continue;
    counts.workspaceResponsesFixed += 1;
    if (args.dryRun) continue;
    await prisma.applicationRequirementResponse.update({
      where: { id: response.id },
      data: { workspaceId: response.application.workspaceId },
    });
  }
}

async function fixFileWorkspace(args: Args) {
  const rows = await prisma.$queryRaw<Array<{ file_id: string; workspace_id: string }>>`
    SELECT DISTINCT f.id AS file_id, a."workspaceId" AS workspace_id
    FROM "File" f
    JOIN "EvidenceFile" ef ON ef."fileId" = f.id
    JOIN "Evidence" e ON e.id = ef."evidenceId"
    JOIN "Application" a ON a.id = e."applicationId"
    WHERE f."workspaceId" IS NULL OR f."workspaceId" <> a."workspaceId"
  `;
  for (const row of rows) {
    counts.fileWorkspaceFixed += 1;
    if (args.dryRun) continue;
    await prisma.file.update({ where: { id: row.file_id }, data: { workspaceId: row.workspace_id } });
  }
}

async function createResponseOnce(
  input: {
    workspaceId: string;
    applicationId: string;
    createdBy: string;
    criterion: Criterion;
    requirementKey: string;
    responseKind: RequirementResponseKind;
    metricId: string | null;
    evidenceId: string | null;
    status: RequirementResponseStatus;
    payloadJson: Prisma.InputJsonValue;
  },
  args: Args,
) {
  const existing = await prisma.applicationRequirementResponse.findFirst({
    where: {
      applicationId: input.applicationId,
      criterion: input.criterion,
      requirementKey: input.requirementKey,
      responseKind: input.responseKind,
      metricId: input.metricId,
      evidenceId: input.evidenceId,
    },
    select: { id: true },
  });
  if (existing) {
    counts.skippedExisting += 1;
    return false;
  }
  if (args.dryRun) return true;
  await prisma.applicationRequirementResponse.create({
    data: {
      workspaceId: input.workspaceId,
      applicationId: input.applicationId,
      createdBy: input.createdBy,
      criterion: input.criterion,
      requirementKey: input.requirementKey,
      responseKind: input.responseKind,
      metricId: input.metricId,
      evidenceId: input.evidenceId,
      status: input.status,
      payloadJson: input.payloadJson,
    },
  });
  return true;
}

function inferEvidenceTarget(
  evidence: Evidence & {
    evidenceCard: EvidenceCard | null;
    event: EventRegistry | null;
  },
) {
  if (evidence.event) {
    if (evidence.event.criterion === Criterion.volunteer) {
      return { criterion: Criterion.volunteer, requirementKey: 'accumulated_volunteer_days' };
    }
    if (evidence.event.criterion === Criterion.physical) {
      return { criterion: Criterion.physical, requirementKey: 'sports_activity_or_award' };
    }
    if (evidence.event.criterion === Criterion.integration) {
      return { criterion: Criterion.integration, requirementKey: 'international_exchange' };
    }
    if (evidence.event.criterion === Criterion.academic) {
      return { criterion: Criterion.academic, requirementKey: 'academic_competition' };
    }
    if (evidence.event.criterion === Criterion.ethics) {
      return { criterion: Criterion.ethics, requirementKey: 'other_ethics_achievement' };
    }
  }

  const fields = evidenceFields(evidence);
  const key = firstKnownRequirementKey(fields);
  if (key) return { criterion: criterionForRequirementKey(key, evidence.criterion), requirementKey: key };
  return { criterion: evidence.criterion, requirementKey: 'legacy_unclassified' };
}

function firstKnownRequirementKey(fields: Record<string, unknown>) {
  const candidates = [
    fields.requirementKey,
    fields.requirement_key,
    fields.physicalPath,
    fields.physicalEvidenceType,
    fields.volunteerPath,
    fields.volunteerEvidenceType,
    fields.integrationPath,
    fields.integrationEvidenceType,
    fields.ethicsAchievementType,
    fields.academicAchievementType,
    fields.achievementType,
    fields.evidenceType,
    fields.pathType,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && knownEvidenceRequirementKeys.has(candidate)) return candidate;
  }
  return null;
}

function criterionForRequirementKey(requirementKey: string, fallback: Criterion) {
  if (
    [
      'political_theory_competition',
      'exemplary_youth',
      'good_person_good_deed',
      'recognized_courageous_action',
      'other_ethics_achievement',
    ].includes(requirementKey)
  ) {
    return Criterion.ethics;
  }
  if (
    [
      'student_research',
      'academic_competition',
      'journal_article',
      'conference_paper',
      'thesis_or_capstone',
      'innovation_product',
      'academic_team',
      'academic_award',
      'other_academic_achievement',
    ].includes(requirementKey)
  ) {
    return Criterion.academic;
  }
  if (
    [
      'healthy_student_title',
      'sports_activity_or_award',
      'sports_team_member',
      'regular_sports_training',
    ].includes(requirementKey)
  ) {
    return Criterion.physical;
  }
  if (['recognized_campaign', 'volunteer_award'].includes(requirementKey)) return Criterion.volunteer;
  if (
    [
      'foreign_language',
      'skills_or_union_training',
      'international_exchange',
      'foreign_language_or_integration_competition',
      'student_union_achievement',
    ].includes(requirementKey)
  ) {
    return Criterion.integration;
  }
  return fallback;
}

function metricPayload(metric: ApplicationMetric) {
  if (metric.metricType === MetricType.gpa) {
    return toJson({
      value: metric.value,
      rawValue: metric.value,
      rawScale: metric.scale,
      scale: metric.scale,
      schoolYear: metric.schoolYear,
      source: metric.source,
      verificationStatus: metric.verificationStatus,
      supportingEvidenceId: metric.supportingEvidenceId,
    });
  }
  if (metric.metricType === MetricType.foreign_language_score) {
    return toJson({
      language: 'other',
      resultForm: 'other',
      certificateType: null,
      equivalentLevel: null,
      score: metric.value,
      source: metric.source ?? 'legacy_metric',
      verificationStatus: metric.verificationStatus,
      schoolYear: metric.schoolYear,
      metricType: metric.metricType,
    });
  }
  return toJson({
    value: metric.value,
    scale: metric.scale,
    schoolYear: metric.schoolYear,
    source: metric.source,
    verificationStatus: metric.verificationStatus,
    supportingEvidenceId: metric.supportingEvidenceId,
    metricType: metric.metricType,
  });
}

function evidencePayload(
  evidence: Evidence & { evidenceCard: EvidenceCard | null; event: EventRegistry | null },
  requirementKey: string,
) {
  const fields = evidenceFields(evidence);
  return toJson({
    requirementKey,
    sourceType: evidence.sourceType,
    evidenceType: fields.evidenceType ?? fields.pathType ?? requirementKey,
    eventId: evidence.eventId,
    convertedValue: evidence.event?.convertedValue ?? numberValue(fields.convertedValue),
    convertedUnit: evidence.event?.convertedUnit ?? stringValue(fields.convertedUnit),
    activityName: stringValue(fields.activityName) ?? stringValue(fields.eventName),
    startDate: stringValue(fields.startDate),
    endDate: stringValue(fields.endDate),
  });
}

function statusFromMetric(status: VerificationStatus) {
  if (status === VerificationStatus.verified) return RequirementResponseStatus.verified;
  if (status === VerificationStatus.rejected) return RequirementResponseStatus.rejected;
  return RequirementResponseStatus.needs_verification;
}

function statusFromEvidence(evidence: Evidence) {
  if (evidence.status === EvidenceStatus.accepted) return RequirementResponseStatus.verified;
  if (evidence.status === EvidenceStatus.rejected || evidence.indexingStatus === IndexingStatus.failed) {
    return RequirementResponseStatus.rejected;
  }
  if (evidence.sourceType === EvidenceSourceType.event_import) return RequirementResponseStatus.verified;
  return RequirementResponseStatus.needs_verification;
}

function evidenceFields(evidence: { evidenceCard: EvidenceCard | null }) {
  const normalized = asRecord(evidence.evidenceCard?.normalizedFieldsJson);
  const extracted = asRecord(evidence.evidenceCard?.extractedFieldsJson);
  return { ...extracted, ...normalized };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function workspaceIdForApplication(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { workspaceId: true },
  });
  return application?.workspaceId ?? null;
}

function parseArgs(argv: string[]): Args {
  return {
    dryRun: argv.includes('--dry-run'),
    workspaceCode: valueFor(argv, '--workspace-code'),
  };
}

function valueFor(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
