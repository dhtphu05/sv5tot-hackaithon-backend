import {
  type ApplicationMetric,
  ApplicationStatus,
  ApplicationType,
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  FinalStatus,
  IndexingStatus,
  Level,
  MetricType,
  VerificationStatus,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { cityRules } from '../../src/modules/rules/city.rules';
import { schoolRules } from '../../src/modules/rules/school.rules';
import { runPrecheck } from '../../src/modules/rules/precheck.engine';
import type { EvidenceWithCard } from '../../src/modules/rules/rules.types';

const application = {
  id: 'app-1',
  studentId: 'student-1',
  schoolYear: '2025-2026',
  applicationType: ApplicationType.individual,
  targetLevel: Level.city,
  status: ApplicationStatus.draft,
  readinessScore: 0,
  currentDraftVersion: 1,
  submittedAt: null,
  finalLevel: null,
  finalStatus: FinalStatus.pending,
  finalNote: null,
  finalizedAt: null,
  finalizedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function metric(metricType: MetricType, value: number) {
  return {
    id: `metric-${metricType}`,
    applicationId: application.id,
    metricType,
    value,
    scale: metricType === MetricType.gpa ? 4 : null,
    evidenceFileId: null,
    verificationStatus: VerificationStatus.unverified,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ApplicationMetric;
}

function evidence(input: {
  id: string;
  criterion: Criterion;
  confidence?: number;
  sourceType?: EvidenceSourceType;
  indexingStatus?: IndexingStatus;
  extractedFieldsJson?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    applicationId: application.id,
    evidenceName: input.id,
    criterion: input.criterion,
    sourceType: input.sourceType ?? EvidenceSourceType.manual_upload,
    eventId: null,
    status: EvidenceStatus.indexed,
    indexingStatus: input.indexingStatus ?? IndexingStatus.indexed,
    confidence: input.confidence ?? 0.9,
    assignedOfficerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    event: null,
    evidenceCard: {
      id: `card-${input.id}`,
      evidenceId: input.id,
      ocrText: null,
      extractedFieldsJson: input.extractedFieldsJson ?? {},
      warningsJson: [],
      matchedEventId: null,
      matchedKnowledgeItemIds: [],
      confidence: input.confidence ?? 0.9,
      aiSummary: null,
      rawAiResponse: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as EvidenceWithCard;
}

describe('rules engine', () => {
  it('marks city volunteer as failed when total volunteer days is below five', () => {
    const result = runPrecheck({
      application,
      metrics: [
        metric(MetricType.gpa, 3.3),
        metric(MetricType.conduct_score, 85),
        metric(MetricType.volunteer_days, 3),
      ],
      evidences: [
        evidence({ id: 'academic', criterion: Criterion.academic }),
        evidence({ id: 'physical', criterion: Criterion.physical }),
        evidence({ id: 'integration', criterion: Criterion.integration }),
      ],
      evidenceCards: [],
      eventImports: [],
      criteriaRules: cityRules,
      targetLevel: Level.city,
      schoolYear: '2025-2026',
    });

    const volunteer = result.criteriaResults.find((item) => item.criterion === Criterion.volunteer);
    expect(volunteer?.status).toBe('failed');
    expect(result.nextBestAction).toContain('cấp Thành phố');
  });

  it('requires human review for low-confidence evidence', () => {
    const result = runPrecheck({
      application,
      metrics: [metric(MetricType.gpa, 3.2), metric(MetricType.conduct_score, 85)],
      evidences: [
        evidence({ id: 'physical-low', criterion: Criterion.physical, confidence: 0.45 }),
        evidence({ id: 'volunteer', criterion: Criterion.volunteer }),
        evidence({ id: 'integration', criterion: Criterion.integration }),
      ],
      evidenceCards: [],
      eventImports: [],
      criteriaRules: schoolRules,
      targetLevel: Level.school,
      schoolYear: '2025-2026',
    });

    const physical = result.criteriaResults.find((item) => item.criterion === Criterion.physical);
    expect(physical?.status).toBe('human_review_required');
    expect(physical?.warnings).toContain('LOW_CONFIDENCE');
  });

  it('returns readyToSubmit for a complete school-level dossier', () => {
    const result = runPrecheck({
      application,
      metrics: [
        metric(MetricType.gpa, 3.2),
        metric(MetricType.conduct_score, 85),
        metric(MetricType.volunteer_days, 3),
      ],
      evidences: [
        evidence({ id: 'physical', criterion: Criterion.physical }),
        evidence({ id: 'integration', criterion: Criterion.integration }),
      ],
      evidenceCards: [],
      eventImports: [],
      criteriaRules: schoolRules,
      targetLevel: Level.school,
      schoolYear: '2025-2026',
    });

    expect(result.readinessScore).toBeGreaterThanOrEqual(80);
    expect(result.readyToSubmit).toBe(true);
    expect(result.humanConfirmationRequired).toBe(true);
  });
});
