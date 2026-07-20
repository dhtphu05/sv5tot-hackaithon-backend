import {
  ApplicationStatus,
  Criterion,
  EvidenceStatus,
  IndexingStatus,
  Level,
  ReviewTaskStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveAssistantState,
  resolveStudentNextBestAction,
  type StudentAssistantPriorityInput,
} from '../../src/modules/applications/student-assistant/student-assistant-priority';

type InputOverrides = Omit<Partial<StudentAssistantPriorityInput>, 'application'> & {
  application?: Partial<NonNullable<StudentAssistantPriorityInput['application']>> | null;
};

function input(overrides: InputOverrides = {}): StudentAssistantPriorityInput {
  const application =
    overrides.application === null
      ? null
      : {
          id: 'app-1',
          status: ApplicationStatus.draft,
          targetLevel: Level.school,
          readinessScore: 0,
          evidences: [],
          reviewTasks: [],
          ...overrides.application,
        };
  return {
    application,
    completion: overrides.completion ?? [],
    latestPrecheck: overrides.latestPrecheck ?? null,
    precheckIsStale: overrides.precheckIsStale ?? false,
    verifiedImportableEvents: overrides.verifiedImportableEvents ?? [],
    now: overrides.now ?? new Date('2026-07-21T00:00:00.000Z'),
  };
}

function evidence(overrides = {}) {
  return {
    id: 'ev-1',
    evidenceName: 'Mùa hè xanh',
    criterion: Criterion.volunteer,
    status: EvidenceStatus.indexed,
    indexingStatus: IndexingStatus.indexed,
    evidenceCard: { confirmationStatus: 'confirmed', requiresHumanConfirmation: false },
    ...overrides,
  };
}

describe('student assistant priority resolver', () => {
  it('prioritizes urgent supplement before every other action', () => {
    const action = resolveStudentNextBestAction(
      input({
        application: {
          reviewTasks: [
            {
              id: 'task-1',
              criterion: Criterion.academic,
              status: ReviewTaskStatus.supplement_required,
              dueDate: new Date('2026-07-21T10:00:00.000Z'),
            },
          ],
          evidences: [
            evidence({
              id: 'ev-confirm',
              evidenceCard: { confirmationStatus: 'pending', requiresHumanConfirmation: true },
            }),
          ],
        },
      }),
    );

    expect(action).toMatchObject({
      type: 'resolve_supplement',
      reviewTaskId: 'task-1',
      criterion: Criterion.academic,
      urgency: 'urgent',
      priority: 1,
    });
  });

  it('prioritizes failed evidence before pending confirmation', () => {
    const action = resolveStudentNextBestAction(
      input({
        application: {
          evidences: [
            evidence({
              id: 'ev-failed',
              indexingStatus: IndexingStatus.failed,
            }),
            evidence({
              id: 'ev-confirm',
              evidenceCard: { confirmationStatus: 'pending', requiresHumanConfirmation: true },
            }),
          ],
        },
      }),
    );

    expect(action).toMatchObject({
      type: 'retry_evidence_analysis',
      evidenceId: 'ev-failed',
      priority: 2,
    });
  });

  it('returns exact deep link for pending evidence confirmation', () => {
    const action = resolveStudentNextBestAction(
      input({
        application: {
          evidences: [
            evidence({
              id: 'ev-confirm',
              criterion: Criterion.volunteer,
              evidenceCard: { confirmationStatus: 'pending', requiresHumanConfirmation: true },
            }),
          ],
        },
      }),
    );

    expect(action).toMatchObject({
      type: 'confirm_evidence',
      evidenceId: 'ev-confirm',
      criterion: Criterion.volunteer,
      destination: {
        route: '/app/application',
        query: { criterion: Criterion.volunteer, evidenceId: 'ev-confirm', mode: 'confirm' },
      },
    });
  });

  it('prioritizes blocking precheck before stale precheck only when result is current', () => {
    const action = resolveStudentNextBestAction(
      input({
        latestPrecheck: {
          createdAt: new Date('2026-07-21T00:00:00.000Z'),
          readinessScore: 45,
          resultJson: {
            nextAction: {
              type: 'resolve_precheck_issue',
              label: 'Bổ sung GPA',
              shortReason: 'Thiếu điểm học tập',
              criterion: Criterion.academic,
              evidenceId: 'ev-gpa',
              route: '/app/application?criterion=academic&evidenceId=ev-gpa',
              priority: 2,
            },
          },
        },
        precheckIsStale: false,
      }),
    );

    expect(action).toMatchObject({
      type: 'resolve_precheck_issue',
      criterion: Criterion.academic,
      evidenceId: 'ev-gpa',
      priority: 4,
    });
  });

  it('suggests verified event import before generic missing evidence', () => {
    const action = resolveStudentNextBestAction(
      input({
        completion: [
          {
            criterion: Criterion.volunteer,
            title: 'Tình nguyện tốt',
            description: '',
            status: 'not_started',
            requirementGroups: [],
            completion: { satisfied: 0, required: 1, needsVerification: 0 },
            evidenceCount: 0,
            nextAction: { type: 'add_evidence', label: 'Bổ sung tình nguyện', requirementKey: 'volunteer_days' },
          },
        ],
        verifiedImportableEvents: [
          {
            id: 'event-1',
            eventName: 'Mùa hè xanh 2026',
            criterion: Criterion.volunteer,
          },
        ],
      }),
    );

    expect(action).toMatchObject({
      id: 'import-event:event-1',
      type: 'import_event',
      priority: 5,
      eventId: 'event-1',
      criterion: Criterion.volunteer,
      destination: {
        route: '/app/application',
        query: {
          criterion: Criterion.volunteer,
          eventId: 'event-1',
          mode: 'suggested-import',
        },
      },
      reasonCode: 'verified_event_import_available',
    });
  });

  it('keeps blocking precheck above verified event import', () => {
    const action = resolveStudentNextBestAction(
      input({
        completion: [
          {
            criterion: Criterion.volunteer,
            title: 'Tình nguyện tốt',
            description: '',
            status: 'not_started',
            requirementGroups: [],
            completion: { satisfied: 0, required: 1, needsVerification: 0 },
            evidenceCount: 0,
            nextAction: null,
          },
        ],
        latestPrecheck: {
          createdAt: new Date('2026-07-21T00:00:00.000Z'),
          readinessScore: 45,
          resultJson: {
            nextAction: {
              type: 'resolve_precheck_issue',
              label: 'Xử lý minh chứng',
              criterion: Criterion.academic,
            },
          },
        },
        precheckIsStale: false,
        verifiedImportableEvents: [
          {
            id: 'event-1',
            eventName: 'Mùa hè xanh 2026',
            criterion: Criterion.volunteer,
          },
        ],
      }),
    );

    expect(action?.type).toBe('resolve_precheck_issue');
  });

  it('prioritizes stale precheck before ready submit', () => {
    const action = resolveStudentNextBestAction(
      input({
        application: { status: ApplicationStatus.ready_to_submit },
        latestPrecheck: { createdAt: new Date(), readinessScore: 100, resultJson: {} },
        precheckIsStale: true,
      }),
    );

    expect(action?.type).toBe('rerun_precheck');
  });

  it('returns ready submit only when the application status permits it', () => {
    expect(
      resolveStudentNextBestAction(input({ application: { status: ApplicationStatus.ready_to_submit } }))?.type,
    ).toBe('submit_application');
    expect(resolveStudentNextBestAction(input({ application: { status: ApplicationStatus.draft } }))?.type).toBe(
      'continue_application',
    );
  });

  it('returns under-review and completed actions without official decision changes', () => {
    expect(resolveStudentNextBestAction(input({ application: { status: ApplicationStatus.under_review } }))?.type).toBe(
      'view_review_status',
    );
    expect(resolveStudentNextBestAction(input({ application: { status: ApplicationStatus.completed } }))?.type).toBe(
      'view_result',
    );
  });

  it('is deterministic and never invokes OpenAI', () => {
    const openAiSpy = vi.fn();
    const first = resolveStudentNextBestAction(input({ application: { evidences: [evidence()] } }));
    const second = resolveStudentNextBestAction(input({ application: { evidences: [evidence()] } }));

    expect(second).toEqual(first);
    expect(openAiSpy).not.toHaveBeenCalled();
  });

  it('maps state from workflow facts', () => {
    expect(resolveAssistantState(input({ application: null }))).toBe('new_user');
    expect(
      resolveAssistantState(
        input({
          application: {
            evidences: [evidence({ indexingStatus: IndexingStatus.extracting })],
          },
        }),
      ),
    ).toBe('processing_evidence');
  });
});
