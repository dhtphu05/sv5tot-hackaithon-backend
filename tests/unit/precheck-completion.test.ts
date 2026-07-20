import { Criterion, EvidenceSourceType, EvidenceStatus, IndexingStatus, Level } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildPrecheckFromCompletion } from '../../src/modules/precheck/precheck.service';
import type { CriterionCompletionDto } from '../../src/modules/criteria-completion/criteria-completion.types';

function completion(input: Partial<CriterionCompletionDto> & Pick<CriterionCompletionDto, 'criterion' | 'status'>): CriterionCompletionDto {
  return {
    criterion: input.criterion,
    title: input.title ?? input.criterion,
    description: input.description ?? '',
    status: input.status,
    requirementGroups: input.requirementGroups ?? [],
    completion: input.completion ?? { satisfied: 0, required: 0, needsVerification: 0 },
    evidenceCount: input.evidenceCount ?? 0,
    nextAction: input.nextAction ?? null,
    additionalAchievementRequired: input.additionalAchievementRequired,
  };
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    targetLevel: Level.school,
    evidences: [],
    reviewTasks: [],
    ...overrides,
  } as never;
}

describe('precheck completion integration', () => {
  it('builds precheck output from requirement completion groups', () => {
    const result = buildPrecheckFromCompletion({
      application: application(),
      level: Level.school,
      criteriaWarnings: [],
      completion: [
        completion({
          criterion: Criterion.academic,
          status: 'needs_verification',
          requirementGroups: [
            {
              key: 'academic_foundation',
              title: 'Kết quả học tập',
              operator: 'all_of',
              optional: false,
              requirements: [
                {
                  key: 'academic_gpa',
                  title: 'GPA/ĐTB',
                  type: 'metric',
                  status: 'verified',
                  optional: false,
                  acceptedSources: ['system_data'],
                  currentResponses: [],
                },
                {
                  key: 'no_f_grade',
                  title: 'Không có điểm F',
                  type: 'system_confirmation',
                  status: 'not_started',
                  optional: false,
                  acceptedSources: ['system_data'],
                  currentResponses: [],
                  nextAction: { type: 'confirm_no_f_grade', label: 'Xác nhận tình trạng điểm F' },
                },
              ],
            },
          ],
        }),
      ],
    });

    expect(result.humanConfirmationRequired).toBe(true);
    expect(result.criteriaResults[0]).toMatchObject({
      criterion: Criterion.academic,
      label: 'Cần xác minh',
      satisfiedRequirements: ['academic_gpa'],
    });
    expect(result.missingItems[0]).toMatchObject({
      criterion: Criterion.academic,
      requirementKey: 'no_f_grade',
      reason: 'Chưa có dữ liệu',
    });
    expect(result.nextAction).toMatchObject({
      criterion: Criterion.academic,
      requirementKey: 'no_f_grade',
      type: 'confirm_no_f_grade',
    });
  });

  it('prioritizes official supplement requests over completion actions', () => {
    const result = buildPrecheckFromCompletion({
      application: application({
        reviewTasks: [
          {
            criterion: Criterion.volunteer,
            status: 'supplement_required',
            supplementRequestJson: { requirementKey: 'accumulated_volunteer_days' },
          },
        ],
      }),
      level: Level.school,
      criteriaWarnings: [],
      completion: [
        completion({
          criterion: Criterion.physical,
          status: 'not_started',
          nextAction: {
            type: 'choose_physical_path',
            label: 'Chọn cách chứng minh Thể lực tốt',
            requirementKey: 'physical_path',
          },
        }),
      ],
    });

    expect(result.nextAction).toMatchObject({
      criterion: Criterion.volunteer,
      requirementKey: 'accumulated_volunteer_days',
      type: 'resolve_supplement_request',
      priority: 1,
    });
  });

  it('does not mark unselected one_of alternatives missing when a path has data', () => {
    const result = buildPrecheckFromCompletion({
      application: application(),
      level: Level.school,
      criteriaWarnings: [],
      completion: [
        completion({
          criterion: Criterion.physical,
          status: 'needs_verification',
          requirementGroups: [
            {
              key: 'physical_path',
              title: 'Cach chung minh The luc tot',
              operator: 'one_of',
              optional: false,
              requirements: [
                {
                  key: 'physical_course_result',
                  title: 'Diem giao duc the chat',
                  type: 'metric',
                  status: 'declared',
                  optional: false,
                  acceptedSources: ['manual_metric'],
                  currentResponses: [],
                  nextAction: {
                    type: 'wait_physical_course_verification',
                    label: 'Cho xac minh diem Giao duc the chat',
                  },
                },
                {
                  key: 'healthy_student_title',
                  title: 'Danh hieu Sinh vien khoe',
                  type: 'evidence',
                  status: 'not_started',
                  optional: false,
                  acceptedSources: ['manual_evidence'],
                  currentResponses: [],
                  nextAction: {
                    type: 'add_physical_path_evidence',
                    label: 'Chon cach chung minh The luc tot',
                  },
                },
              ],
            },
          ],
          nextAction: {
            type: 'wait_physical_course_verification',
            label: 'Cho xac minh diem Giao duc the chat',
            requirementKey: 'physical_course_result',
          },
        }),
      ],
    });

    expect(result.missingItems).toHaveLength(0);
    expect(result.criteriaResults[0].missingRequirements).toHaveLength(0);
    expect(result.criteriaResults[0].needsVerification).toHaveLength(1);
    expect(result.nextAction).toMatchObject({
      criterion: Criterion.physical,
      requirementKey: 'physical_course_result',
      type: 'wait_physical_course_verification',
    });
  });

  it('prioritizes exact evidence confirmation actions over generic verification', () => {
    const result = buildPrecheckFromCompletion({
      application: application(),
      level: Level.school,
      criteriaWarnings: [],
      completion: [
        completion({
          criterion: Criterion.volunteer,
          status: 'needs_verification',
          requirementGroups: [
            {
              key: 'volunteer_foundation',
              title: 'Ngày tình nguyện',
              operator: 'all_of',
              optional: false,
              requirements: [
                {
                  key: 'accumulated_volunteer_days',
                  title: 'Tổng ngày tình nguyện',
                  type: 'activity_aggregation',
                  status: 'needs_verification',
                  optional: false,
                  acceptedSources: ['manual_evidence'],
                  currentResponses: [
                    {
                      id: 'evidence-confirmation',
                      responseKind: 'legacy_evidence',
                      status: 'needs_verification',
                      evidenceId: 'evidence-123',
                      source: 'legacy',
                      payloadJson: {
                        needsEvidenceConfirmation: true,
                        evidenceId: 'evidence-123',
                        confirmationStatus: 'pending',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    });

    expect(result.nextAction).toMatchObject({
      type: 'confirm_evidence',
      evidenceId: 'evidence-123',
      destination: '/app/application?evidenceId=evidence-123&mode=confirm',
      priority: 1,
    });
  });

  it('does not emit final result or confidence from precheck output', () => {
    const result = buildPrecheckFromCompletion({
      application: application({
        evidences: [
          {
            criterion: Criterion.integration,
            sourceType: EvidenceSourceType.manual_upload,
            status: EvidenceStatus.indexed,
            indexingStatus: IndexingStatus.indexed,
          },
        ],
      }),
      level: Level.school,
      criteriaWarnings: [],
      completion: [completion({ criterion: Criterion.integration, status: 'ready_for_precheck' })],
    });

    expect(result).not.toHaveProperty('finalResult');
    expect(result).not.toHaveProperty('confidence');
  });
});
