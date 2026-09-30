import {
  ApplicationStatus,
  ApplicationType,
  Level,
  Role,
  VerificationStatus,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  application: { findUnique: vi.fn() },
  applicationMetric: { upsert: vi.fn() },
  applicationRequirementResponse: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  txQueryRaw: vi.fn(),
  txExecuteRaw: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    $transaction: mocks.$transaction,
    application: mocks.application,
  },
}));

vi.mock('../../src/modules/rules/criteria.loader', () => ({
  loadCriteriaRules: vi.fn().mockResolvedValue({ rules: [] }),
  toJsonValue: (value: unknown) => value,
}));

vi.mock('../../src/modules/criteria-completion/criteria-requirement.parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/criteria-completion/criteria-requirement.parser')>();
  return {
  ...actual,
  buildRequirementGroupsByCriterion: vi.fn(() => ({
      academic: [
        {
          requirements: [
            { key: 'gpa_university', type: 'metric', config: { metricType: 'gpa' } },
            { key: 'gpa_college', type: 'metric', config: { metricType: 'gpa' } },
          ],
        },
      ],
    })),
  };
});

import { CriteriaCompletionService } from '../../src/modules/criteria-completion/criteria-completion.service';

const application = {
  id: 'application-1',
  studentId: 'student-1',
  workspaceId: 'school-1',
  schoolYear: '2025-2026',
  targetLevel: Level.city,
  applicationType: ApplicationType.individual,
  status: ApplicationStatus.draft,
  cancelledAt: null,
};

const tx = {
  $queryRaw: mocks.txQueryRaw,
  $executeRaw: mocks.txExecuteRaw,
  applicationMetric: mocks.applicationMetric,
  applicationRequirementResponse: mocks.applicationRequirementResponse,
  auditLog: mocks.auditLog,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.application.findUnique.mockResolvedValue(application);
  mocks.txQueryRaw.mockResolvedValue([{ id: application.id, cancelledAt: null }]);
  mocks.applicationMetric.upsert.mockResolvedValue({ id: 'metric-1' });
  mocks.applicationRequirementResponse.create.mockResolvedValue({ id: 'response-1' });
  mocks.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  mocks.$transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) =>
    callback(tx),
  );
});

describe('academic GPA declaration database operations', () => {
  it('loads only the application fields it needs and saves metric metadata in the upsert', async () => {
    const service = new CriteriaCompletionService();
    const student = {
      id: 'student-1',
      workspaceId: 'school-1',
      email: 'student@example.test',
      role: Role.student,
      fullName: 'Student One',
      studentCode: '0001',
      className: 'A1',
      faculty: null,
      avatarUrl: null,
      workspace: null,
    };

    await service.declareAcademicGpa(student, application.id, {
      value: 3.5,
      scale: 4,
      schoolYear: '2025-2026',
      sourceType: 'manual_metric',
    });

    expect(mocks.application.findUnique).toHaveBeenCalledWith({
      where: { id: application.id },
      select: {
        id: true,
        studentId: true,
        workspaceId: true,
        schoolYear: true,
        targetLevel: true,
        applicationType: true,
        status: true,
        cancelledAt: true,
      },
    });
    expect(mocks.applicationMetric.upsert).toHaveBeenCalledWith({
      where: {
        applicationId_metricType: {
          applicationId: application.id,
          metricType: 'gpa',
        },
      },
      update: {
        value: 3.5,
        scale: 4,
        schoolYear: '2025-2026',
        source: 'manual_metric',
        supportingEvidenceId: null,
        verificationStatus: VerificationStatus.unverified,
      },
      create: {
        applicationId: application.id,
        metricType: 'gpa',
        value: 3.5,
        scale: 4,
        schoolYear: '2025-2026',
        source: 'manual_metric',
        supportingEvidenceId: null,
        verificationStatus: VerificationStatus.unverified,
      },
    });
    expect(mocks.txExecuteRaw).not.toHaveBeenCalled();
    expect(mocks.applicationRequirementResponse.create).toHaveBeenCalledOnce();
    expect(mocks.applicationRequirementResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requirementKey: 'academic_gpa' }),
    });
    expect(mocks.auditLog.create).toHaveBeenCalledOnce();
  });
});
