import { ApplicationStatus, ApplicationType, FinalStatus, Level, MetricType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { assertApplicationEditable } from '../../src/modules/applications/application.helpers';
import { assertMetricValue } from '../../src/modules/metrics/metrics.validation';
import { normalizeSchoolYear } from '../../src/shared/utils/school-year';

const baseApplication = {
  id: 'app-id',
  studentId: 'student-id',
  schoolYear: '2025-2026',
  applicationType: ApplicationType.individual,
  targetLevel: Level.school,
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

describe('application helpers', () => {
  it('accepts a valid school year', () => {
    expect(normalizeSchoolYear('2025-2026')).toBe('2025-2026');
  });

  it('rejects a non-consecutive school year', () => {
    expect(() => normalizeSchoolYear('2025-2027')).toThrow('School year end must equal start + 1');
  });

  it('allows editable application statuses', () => {
    expect(() => assertApplicationEditable(baseApplication)).not.toThrow();
  });

  it('rejects locked application statuses', () => {
    expect(() =>
      assertApplicationEditable({
        ...baseApplication,
        status: ApplicationStatus.submitted,
      }),
    ).toThrow('Application cannot be edited');
  });
});

describe('metric validation', () => {
  it('accepts GPA within a 4.0 scale', () => {
    expect(() => assertMetricValue(MetricType.gpa, 3.45, 4.0)).not.toThrow();
  });

  it('rejects GPA above a 4.0 scale', () => {
    expect(() => assertMetricValue(MetricType.gpa, 4.5, 4.0)).toThrow(
      'GPA must be between 0 and 4',
    );
  });

  it('rejects conduct score above 100', () => {
    expect(() => assertMetricValue(MetricType.conduct_score, 120)).toThrow(
      'Conduct score must be between 0 and 100',
    );
  });
});
