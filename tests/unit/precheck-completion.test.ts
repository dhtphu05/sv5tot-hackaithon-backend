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

  it('does not treat reviewer-owned ethics verification as student missing work across all criteria', () => {
    const result = buildPrecheckFromCompletion({
      application: application(),
      level: Level.school,
      criteriaWarnings: [],
      completion: [
        completion({
          criterion: Criterion.ethics,
          status: 'ready_for_precheck',
          requirementGroups: [
            {
              key: 'ethics_foundation',
              title: 'Ethics foundation',
              operator: 'all_of',
              optional: false,
              requirements: [
                {
                  key: 'conduct_score',
                  title: 'Conduct score',
                  type: 'metric',
                  status: 'verified',
                  optional: false,
                  acceptedSources: ['system_data'],
                  currentResponses: [],
                  responsibility: 'student',
                  blocksSubmission: true,
                  verificationStage: 'draft',
                },
                {
                  key: 'no_violation',
                  title: 'No violation',
                  type: 'system_confirmation',
                  status: 'not_started',
                  optional: false,
                  acceptedSources: ['system_data'],
                  currentResponses: [],
                  responsibility: 'reviewer',
                  blocksSubmission: false,
                  verificationStage: 'review',
                },
              ],
            },
          ],
        }),
        completion({
          criterion: Criterion.academic,
          status: 'in_progress',
          requirementGroups: [
            {
              key: 'academic_foundation',
              title: 'Academic foundation',
              operator: 'all_of',
              optional: false,
              requirements: [
                {
                  key: 'academic_gpa',
                  title: 'GPA',
                  type: 'metric',
                  status: 'verified',
                  optional: false,
                  acceptedSources: ['system_data'],
                  currentResponses: [],
                },
                {
                  key: 'no_f_grade',
                  title: 'No F grade',
                  type: 'system_confirmation',
                  status: 'not_started',
                  optional: false,
                  acceptedSources: ['system_data'],
                  currentResponses: [],
                },
              ],
            },
          ],
        }),
        completion({
          criterion: Criterion.physical,
          status: 'not_started',
          nextAction: {
            type: 'choose_physical_path',
            label: 'Chon cach chung minh The luc tot',
            requirementKey: 'physical_path',
          },
        }),
        completion({
          criterion: Criterion.volunteer,
          status: 'needs_verification',
          requirementGroups: [
            {
              key: 'volunteer_path',
              title: 'Volunteer path',
              operator: 'one_of',
              optional: false,
              requirements: [
                {
                  key: 'accumulated_volunteer_days',
                  title: 'Volunteer days',
                  type: 'activity_aggregation',
                  status: 'declared',
                  optional: false,
                  acceptedSources: ['manual_evidence'],
                  currentResponses: [],
                },
              ],
            },
          ],
        }),
        completion({
          criterion: Criterion.integration,
          status: 'ready_for_precheck',
          requirementGroups: [
            {
              key: 'integration_path',
              title: 'Integration path',
              operator: 'one_of',
              optional: false,
              requirements: [
                {
                  key: 'foreign_language',
                  title: 'Foreign language',
                  type: 'evidence',
                  status: 'verified',
                  optional: false,
                  acceptedSources: ['manual_evidence'],
                  currentResponses: [],
                },
              ],
            },
          ],
        }),
      ],
    });

    const ethics = result.criteriaResults.find((item) => item.criterion === Criterion.ethics);
    expect(ethics?.missingRequirements).toHaveLength(0);
    expect(ethics?.needsVerification).toHaveLength(0);
    expect(ethics?.requirementGroups[0].requirements[1]).toMatchObject({
      key: 'no_violation',
      responsibility: 'reviewer',
      blocksSubmission: false,
      verificationStage: 'review',
    });
    expect(result.missingItems.map((item) => item.requirementKey)).toContain('no_f_grade');
    expect(
      result.criteriaResults
        .find((item) => item.criterion === Criterion.volunteer)
        ?.needsVerification.map((item) => item.requirementKey),
    ).toEqual(['accumulated_volunteer_days']);
    expect(result.missingItems.map((item) => item.requirementKey)).not.toContain('no_violation');
    expect(result.readyToSubmit).toBe(false);
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
      type: 'submit_application',
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
