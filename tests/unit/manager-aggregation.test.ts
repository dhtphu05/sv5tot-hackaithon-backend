import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  FinalStatus,
  Level,
  ReviewTaskStatus,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildAggregation } from '../../src/modules/manager/manager.service';

const baseApplication = {
  id: 'app-1',
  studentId: 'student-1',
  schoolYear: '2025-2026',
  applicationType: ApplicationType.individual,
  targetLevel: Level.city,
  status: ApplicationStatus.under_review,
  readinessScore: 88,
  currentDraftVersion: 2,
  submittedAt: new Date(),
  finalLevel: null,
  finalStatus: FinalStatus.pending,
  finalNote: null,
  finalizedAt: null,
  finalizedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  student: {
    id: 'student-1',
    fullName: 'Nguyen Van A',
    email: 'student@dut.udn.vn',
    passwordHash: 'hash',
    phone: null,
    role: 'student',
    studentCode: '102220001',
    className: '22T',
    faculty: 'CNTT',
    avatarUrl: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  evidences: [],
  precheckResults: [],
  cascadeReviews: [],
};

function task(criterion: Criterion, status: ReviewTaskStatus) {
  return {
    id: `task-${criterion}`,
    applicationId: 'app-1',
    criterion,
    assignedOfficerId: null,
    status,
    decision: null,
    officerNote: null,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    evidences: [],
  };
}

describe('buildAggregation', () => {
  it('allows finalize when all required tasks are terminal and no open resolution exists', () => {
    const aggregation = buildAggregation({
      ...baseApplication,
      reviewTasks: [
        task(Criterion.ethics, ReviewTaskStatus.accepted),
        task(Criterion.academic, ReviewTaskStatus.accepted),
        task(Criterion.physical, ReviewTaskStatus.accepted),
        task(Criterion.volunteer, ReviewTaskStatus.accepted),
        task(Criterion.integration, ReviewTaskStatus.accepted),
      ],
      resolutionCases: [],
    } as never);

    expect(aggregation.canFinalize).toBe(true);
    expect(aggregation.suggestedFinalStatus).toBe(FinalStatus.passed);
  });

  it('blocks finalize while waiting task or open resolution exists', () => {
    const aggregation = buildAggregation({
      ...baseApplication,
      reviewTasks: [
        task(Criterion.ethics, ReviewTaskStatus.accepted),
        task(Criterion.academic, ReviewTaskStatus.waiting),
      ],
      resolutionCases: [
        {
          id: 'case-1',
          applicationId: 'app-1',
          evidenceId: null,
          reason: 'Need review',
          status: 'open',
          committeeDecision: null,
          createdBy: 'officer-1',
          closedBy: null,
          createdAt: new Date(),
          closedAt: null,
        },
      ],
    } as never);

    expect(aggregation.canFinalize).toBe(false);
    expect(aggregation.blockingReasons).toContain('Còn task đang chờ xét.');
    expect(aggregation.blockingReasons).toContain('Còn resolution case chưa xử lý.');
  });
});
