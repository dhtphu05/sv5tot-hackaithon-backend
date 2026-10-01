import { describe, expect, it, vi } from 'vitest';
import { CriteriaCompletionRepository } from '../../src/modules/criteria-completion/criteria-completion.repository';
import { CriteriaCompletionService } from '../../src/modules/criteria-completion/criteria-completion.service';

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {},
}));

vi.mock('../../src/modules/rules/criteria.loader', () => ({
  loadCriteriaRules: vi.fn().mockResolvedValue({ rules: [] }),
  toJsonValue: (value: unknown) => value,
}));

describe('criteria completion read query', () => {
  it('selects only the fields used to compute the completion DTO', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const repository = new CriteriaCompletionRepository({
      application: { findUnique },
    } as never);

    await repository.findApplicationForCompletion('application-1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      select: {
        id: true,
        studentId: true,
        workspaceId: true,
        schoolYear: true,
        targetLevel: true,
        student: { select: { faculty: true } },
        workspace: { select: { type: true, isActive: true } },
        metrics: {
          select: {
            id: true,
            metricType: true,
            value: true,
            scale: true,
            verificationStatus: true,
            schoolYear: true,
            source: true,
            supportingEvidenceId: true,
          },
        },
        evidences: {
          select: {
            id: true,
            criterion: true,
            sourceType: true,
            status: true,
            indexingStatus: true,
            confidence: true,
            event: { select: { convertedValue: true, convertedUnit: true } },
            evidenceCard: {
              select: {
                extractedFieldsJson: true,
                normalizedFieldsJson: true,
                confirmedFieldsJson: true,
                confirmationStatus: true,
                requiresHumanConfirmation: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        reviewTasks: { select: { criterion: true, status: true } },
        requirementResponses: {
          select: {
            id: true,
            criterion: true,
            requirementKey: true,
            responseKind: true,
            status: true,
            metricId: true,
            evidenceId: true,
            payloadJson: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  });

  it('uses the narrow read query for completion instead of the write context query', async () => {
    const findApplicationForCompletion = vi.fn().mockResolvedValue({
      id: 'application-1',
      studentId: 'student-1',
      workspaceId: 'school-1',
      schoolYear: '2025-2026',
      targetLevel: 'city',
      student: { faculty: null },
      workspace: { type: 'SCHOOL', isActive: true },
      metrics: [],
      evidences: [],
      reviewTasks: [],
      requirementResponses: [],
    });
    const findApplicationContext = vi.fn();
    const service = new CriteriaCompletionService({
      findApplicationForCompletion,
      findApplicationContext,
    } as never);

    await service.getCompletion(
      {
        id: 'student-1',
        workspaceId: 'school-1',
        role: 'student',
        faculty: null,
      } as never,
      'application-1',
    );

    expect(findApplicationForCompletion).toHaveBeenCalledWith('application-1');
    expect(findApplicationContext).not.toHaveBeenCalled();
  });
});
