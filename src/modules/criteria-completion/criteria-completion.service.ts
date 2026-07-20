import {
  ApplicationStatus,
  Criterion,
  MetricType,
  Prisma,
  RequirementResponseKind,
  RequirementResponseStatus,
  Role,
  VerificationStatus,
  type Application,
  type User,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { assertSameWorkspace } from '../../shared/utils/workspace-scope';
import { createApplicationAudit } from '../applications/application.helpers';
import { coreCriteria } from '../rules/criteria.constants';
import { loadCriteriaRules, toJsonValue } from '../rules/criteria.loader';
import { assertPrecheckAccess } from '../precheck/precheck.service';
import { evaluateCriterionCompletion } from './criteria-completion.evaluator';
import { CriteriaCompletionRepository } from './criteria-completion.repository';
import type {
  CompletionEvidence,
  CompletionResponse,
  CriterionCompletionDto,
} from './criteria-completion.types';
import { buildRequirementGroupsByCriterion, criterionTitle } from './criteria-requirement.parser';
import type {
  CreateRequirementResponseInput,
  AddAcademicAchievementInput,
  AddIntegrationPathResponseInput,
  AddPhysicalPathEvidenceInput,
  AddVolunteerActivityInput,
  AddVolunteerPathEvidenceInput,
  AddEthicsAchievementInput,
  ConfirmNoFGradeInput,
  ConfirmNoViolationInput,
  DeclareAcademicGpaInput,
  DeclareConductScoreInput,
  DeclarePhysicalCourseResultInput,
  LinkConductScoreMetricInput,
  UpdateRequirementResponseInput,
} from './criteria-completion.validation';

const physicalRequirementKeys = [
  'physical_course_result',
  'healthy_student_title',
  'sports_activity_or_award',
  'sports_team_member',
  'regular_sports_training',
];

const volunteerActivityRequirementKeys = ['accumulated_volunteer_days', 'activity_count'];

type CompletionApplication = NonNullable<
  Awaited<ReturnType<CriteriaCompletionRepository['findApplicationContext']>>
>;

export class CriteriaCompletionService {
  constructor(private readonly repository = new CriteriaCompletionRepository()) {}

  async getCompletion(user: AuthenticatedUser, applicationId: string) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, true);

    const criteria = await loadCriteriaRules({
      workspaceId: application.workspaceId,
      schoolYear: application.schoolYear,
      level: application.targetLevel,
    });
    const groupsByCriterion = buildRequirementGroupsByCriterion(criteria.rules);
    const responses = application.requirementResponses as CompletionResponse[];
    const items = coreCriteria.map((criterion) =>
      evaluateCriterionCompletion({
        criterion,
        title: criterionTitle(criterion),
        description: `Điều kiện hoàn thiện cho tiêu chí ${criterionTitle(criterion)}.`,
        groups: groupsByCriterion[criterion] ?? [],
        metrics: application.metrics,
        evidences: application.evidences as CompletionEvidence[],
        responses: responses.filter((response) => response.criterion === criterion),
        reviewStatus: application.reviewTasks.find((task) => task.criterion === criterion)?.status,
        evidenceCount: application.evidences.filter((evidence) => evidence.criterion === criterion)
          .length,
        schoolYear: application.schoolYear,
      }),
    );

    return {
      applicationId: application.id,
      criteriaVersionId: criteria.criteriaVersionId,
      targetLevel: application.targetLevel,
      items,
      summary: buildSummary(items),
      generatedAt: new Date().toISOString(),
    };
  }

  async createResponse(
    user: AuthenticatedUser,
    applicationId: string,
    input: CreateRequirementResponseInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, input.criterion);
    assertRequirementStatusMutationAllowed(
      user,
      input.requirementKey,
      input.status,
      input.responseKind,
    );
    await this.assertRequirementKey(application, input.criterion, input.requirementKey);
    await this.assertLinkedRecords(application, input);

    const created = await prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: input.criterion,
          requirementKey: input.requirementKey,
          responseKind: input.responseKind,
          metric: input.metricId ? { connect: { id: input.metricId } } : undefined,
          evidence: input.evidenceId ? { connect: { id: input.evidenceId } } : undefined,
          payloadJson:
            input.payloadJson === undefined ? Prisma.JsonNull : toJsonValue(input.payloadJson),
          status: input.status,
          creator: { connect: { id: user.id } },
        },
        tx,
      );

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });

      return saved;
    });

    return created;
  }

  async updateResponse(
    user: AuthenticatedUser,
    responseId: string,
    input: UpdateRequirementResponseInput,
  ) {
    const existing = await this.getResponse(responseId);
    const criterion = existing.criterion;
    await this.assertCanMutateResponse(user, existing.application, criterion);
    assertRequirementStatusMutationAllowed(
      user,
      input.requirementKey ?? existing.requirementKey,
      input.status,
      input.responseKind ?? existing.responseKind,
    );
    if (input.requirementKey) {
      await this.assertRequirementKey(existing.application, criterion, input.requirementKey);
    }
    await this.assertLinkedRecords(existing.application, {
      ...input,
      criterion,
      requirementKey: input.requirementKey ?? existing.requirementKey,
      responseKind: input.responseKind ?? existing.responseKind,
      status: input.status ?? existing.status,
    });

    return prisma.$transaction(async (tx) => {
      const updated = await this.repository.updateResponse(
        existing.id,
        {
          ...(input.requirementKey ? { requirementKey: input.requirementKey } : {}),
          ...(input.responseKind ? { responseKind: input.responseKind } : {}),
          ...(input.metricId !== undefined
            ? {
                metric: input.metricId ? { connect: { id: input.metricId } } : { disconnect: true },
              }
            : {}),
          ...(input.evidenceId !== undefined
            ? {
                evidence: input.evidenceId
                  ? { connect: { id: input.evidenceId } }
                  : { disconnect: true },
              }
            : {}),
          ...(input.payloadJson !== undefined
            ? { payloadJson: toJsonValue(input.payloadJson) }
            : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        tx,
      );

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: existing.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_UPDATED,
        targetType: 'requirement_response',
        targetId: updated.id,
        applicationId: existing.applicationId,
        beforeStateJson: toJsonValue(existing),
        afterStateJson: toJsonValue(updated),
      });

      return updated;
    });
  }

  async linkEthicsConductScoreMetric(
    user: AuthenticatedUser,
    applicationId: string,
    input: LinkConductScoreMetricInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.ethics);
    await this.assertRequirementKey(application, Criterion.ethics, 'conduct_score');
    const metric = await prisma.applicationMetric.findUnique({ where: { id: input.metricId } });
    if (!metric || metric.applicationId !== application.id) {
      throw new AppError(400, ErrorCodes.METRIC_NOT_FOUND, 'Metric is not linked to application');
    }
    if (metric.metricType !== MetricType.conduct_score) {
      throw new AppError(400, ErrorCodes.INVALID_METRIC_VALUE, 'Metric must be conduct_score');
    }

    return prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.ethics,
          requirementKey: 'conduct_score',
          responseKind: RequirementResponseKind.metric,
          metric: { connect: { id: metric.id } },
          payloadJson: toJsonValue({
            value: metric.value,
            scale: metric.scale ?? 100,
            sourceType:
              metric.verificationStatus === VerificationStatus.verified
                ? 'system_data'
                : 'manual_metric',
          }),
          status: responseStatusForMetric(metric.verificationStatus),
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async declareEthicsConductScore(
    user: AuthenticatedUser,
    applicationId: string,
    input: DeclareConductScoreInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.ethics);
    await this.assertRequirementKey(application, Criterion.ethics, 'conduct_score');
    if (input.evidenceId) {
      await this.assertLinkedRecords(application, {
        responseKind: RequirementResponseKind.evidence,
        evidenceId: input.evidenceId,
      });
    }

    return prisma.$transaction(async (tx) => {
      const metric = await tx.applicationMetric.upsert({
        where: {
          applicationId_metricType: {
            applicationId: application.id,
            metricType: MetricType.conduct_score,
          },
        },
        update: {
          value: input.value,
          scale: input.scale,
          verificationStatus: VerificationStatus.unverified,
        },
        create: {
          applicationId: application.id,
          metricType: MetricType.conduct_score,
          value: input.value,
          scale: input.scale,
          verificationStatus: VerificationStatus.unverified,
        },
      });
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.ethics,
          requirementKey: 'conduct_score',
          responseKind: RequirementResponseKind.metric,
          metric: { connect: { id: metric.id } },
          evidence: input.evidenceId ? { connect: { id: input.evidenceId } } : undefined,
          payloadJson: toJsonValue({
            value: input.value,
            scale: input.scale,
            schoolYear: input.schoolYear ?? application.schoolYear,
            sourceType: input.sourceType,
          }),
          status: input.evidenceId
            ? RequirementResponseStatus.needs_verification
            : RequirementResponseStatus.declared,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async confirmEthicsNoViolation(
    user: AuthenticatedUser,
    applicationId: string,
    input: ConfirmNoViolationInput,
  ) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, true);
    if (user.role !== Role.officer && user.role !== Role.manager && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only staff can confirm no_violation');
    }
    await this.assertRequirementKey(application, Criterion.ethics, 'no_violation');

    return prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.ethics,
          requirementKey: 'no_violation',
          responseKind: RequirementResponseKind.system_confirmation,
          payloadJson:
            input.payloadJson === undefined ? Prisma.JsonNull : toJsonValue(input.payloadJson),
          status: input.status,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async addEthicsAchievement(
    user: AuthenticatedUser,
    applicationId: string,
    input: AddEthicsAchievementInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.ethics);
    await this.assertRequirementKey(application, Criterion.ethics, input.achievementType);
    await this.assertLinkedRecords(application, {
      responseKind: RequirementResponseKind.evidence,
      evidenceId: input.evidenceId,
    });

    return prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.ethics,
          requirementKey: input.achievementType,
          responseKind: RequirementResponseKind.evidence,
          evidence: { connect: { id: input.evidenceId } },
          payloadJson: toJsonValue({
            evidenceType: input.achievementType,
            optional: true,
          }),
          status: RequirementResponseStatus.needs_verification,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async declareAcademicGpa(
    user: AuthenticatedUser,
    applicationId: string,
    input: DeclareAcademicGpaInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.academic);
    await this.assertRequirementKey(application, Criterion.academic, 'academic_gpa');
    if (input.schoolYear !== application.schoolYear) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'GPA schoolYear must match application');
    }
    if (input.evidenceId) {
      await this.assertLinkedRecords(application, {
        responseKind: RequirementResponseKind.evidence,
        evidenceId: input.evidenceId,
      });
    }

    const normalizedValue = input.scale === 10 ? input.value / 2.5 : input.value;
    return prisma.$transaction(async (tx) => {
      const metric = await tx.applicationMetric.upsert({
        where: {
          applicationId_metricType: {
            applicationId: application.id,
            metricType: MetricType.gpa,
          },
        },
        update: {
          value: input.value,
          scale: input.scale,
          verificationStatus: VerificationStatus.unverified,
        },
        create: {
          applicationId: application.id,
          metricType: MetricType.gpa,
          value: input.value,
          scale: input.scale,
          verificationStatus: VerificationStatus.unverified,
        },
      });
      await tx.$executeRaw`
        UPDATE "ApplicationMetric"
        SET "schoolYear" = ${input.schoolYear},
            "source" = ${input.sourceType},
            "supportingEvidenceId" = ${input.evidenceId ?? null}
        WHERE "id" = ${metric.id}::uuid
      `;
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.academic,
          requirementKey: 'academic_gpa',
          responseKind: RequirementResponseKind.metric,
          metric: { connect: { id: metric.id } },
          evidence: input.evidenceId ? { connect: { id: input.evidenceId } } : undefined,
          payloadJson: toJsonValue({
            value: input.value,
            scale: input.scale,
            rawValue: input.value,
            rawScale: input.scale,
            normalizedValue,
            thresholdScale: 4,
            schoolYear: input.schoolYear,
            sourceType: input.sourceType,
            source: input.sourceType,
            verificationStatus: VerificationStatus.unverified,
            supportingEvidenceId: input.evidenceId ?? null,
          }),
          status: input.evidenceId
            ? RequirementResponseStatus.needs_verification
            : RequirementResponseStatus.declared,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async confirmAcademicNoFGrade(
    user: AuthenticatedUser,
    applicationId: string,
    input: ConfirmNoFGradeInput,
  ) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, true);
    if (user.role !== Role.officer && user.role !== Role.manager && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only staff can confirm no_f_grade');
    }
    await this.assertRequirementKey(application, Criterion.academic, 'no_f_grade');

    return prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.academic,
          requirementKey: 'no_f_grade',
          responseKind: RequirementResponseKind.system_confirmation,
          payloadJson:
            input.payloadJson === undefined ? Prisma.JsonNull : toJsonValue(input.payloadJson),
          status: input.status,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async addAcademicAchievement(
    user: AuthenticatedUser,
    applicationId: string,
    input: AddAcademicAchievementInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.academic);
    await this.assertRequirementKey(application, Criterion.academic, input.achievementType);
    await this.assertLinkedRecords(application, {
      responseKind: RequirementResponseKind.evidence,
      evidenceId: input.evidenceId,
    });

    return prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.academic,
          requirementKey: input.achievementType,
          responseKind: RequirementResponseKind.evidence,
          evidence: { connect: { id: input.evidenceId } },
          payloadJson: toJsonValue({
            evidenceType: input.achievementType,
          }),
          status: RequirementResponseStatus.needs_verification,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async declarePhysicalCourseResult(
    user: AuthenticatedUser,
    applicationId: string,
    input: DeclarePhysicalCourseResultInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.physical);
    await this.assertRequirementKey(application, Criterion.physical, 'physical_course_result');
    if (input.schoolYear !== application.schoolYear) {
      throw new AppError(
        400,
        ErrorCodes.VALIDATION_ERROR,
        'Physical course schoolYear must match application',
      );
    }
    if (input.evidenceId) {
      await this.assertLinkedRecords(application, {
        responseKind: RequirementResponseKind.evidence,
        evidenceId: input.evidenceId,
      });
    }

    return prisma.$transaction(async (tx) => {
      if (input.replaceExisting) {
        await this.supersedePhysicalResponses(tx, application.id);
      }

      let metricConnect: { connect: { id: string } } | undefined;
      if (input.resultType === 'score') {
        const metric = await tx.applicationMetric.upsert({
          where: {
            applicationId_metricType: {
              applicationId: application.id,
              metricType: MetricType.physical_score,
            },
          },
          update: {
            value: input.value ?? 0,
            scale: 10,
            verificationStatus: VerificationStatus.unverified,
          },
          create: {
            applicationId: application.id,
            metricType: MetricType.physical_score,
            value: input.value ?? 0,
            scale: 10,
            verificationStatus: VerificationStatus.unverified,
          },
        });
        await tx.$executeRaw`
          UPDATE "ApplicationMetric"
          SET "schoolYear" = ${input.schoolYear},
              "source" = ${input.sourceType},
              "supportingEvidenceId" = ${input.evidenceId ?? null}
          WHERE "id" = ${metric.id}::uuid
        `;
        metricConnect = { connect: { id: metric.id } };
      }

      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.physical,
          requirementKey: 'physical_course_result',
          responseKind:
            input.resultType === 'score'
              ? RequirementResponseKind.metric
              : RequirementResponseKind.system_confirmation,
          metric: metricConnect,
          evidence: input.evidenceId ? { connect: { id: input.evidenceId } } : undefined,
          payloadJson: toJsonValue({
            pathType: 'physical_course_result',
            resultType: input.resultType,
            value: input.value ?? null,
            scale: input.resultType === 'score' ? 10 : null,
            classification: input.classification ?? null,
            schoolYear: input.schoolYear,
            sourceType: input.sourceType,
            source: input.sourceType,
            verificationStatus: VerificationStatus.unverified,
            supportingEvidenceId: input.evidenceId ?? null,
          }),
          status: input.evidenceId
            ? RequirementResponseStatus.needs_verification
            : RequirementResponseStatus.declared,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async addPhysicalPathEvidence(
    user: AuthenticatedUser,
    applicationId: string,
    input: AddPhysicalPathEvidenceInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.physical);
    await this.assertRequirementKey(application, Criterion.physical, input.requirementKey);
    await this.assertLinkedRecords(application, {
      responseKind:
        input.sourceType === 'official_event'
          ? RequirementResponseKind.official_event
          : RequirementResponseKind.evidence,
      evidenceId: input.evidenceId,
    });

    return prisma.$transaction(async (tx) => {
      if (input.replaceExisting) {
        await this.supersedePhysicalResponses(tx, application.id);
      }

      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.physical,
          requirementKey: input.requirementKey,
          responseKind:
            input.sourceType === 'official_event'
              ? RequirementResponseKind.official_event
              : RequirementResponseKind.evidence,
          evidence: { connect: { id: input.evidenceId } },
          payloadJson: toJsonValue({
            ...(input.payloadJson ?? {}),
            evidenceType: input.requirementKey,
            pathType: input.requirementKey,
            sourceType: input.sourceType,
          }),
          status: RequirementResponseStatus.needs_verification,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async addVolunteerActivity(
    user: AuthenticatedUser,
    applicationId: string,
    input: AddVolunteerActivityInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.volunteer);
    await this.assertRequirementKey(application, Criterion.volunteer, input.requirementKey);
    if (input.evidenceId) {
      await this.assertLinkedRecords(application, {
        responseKind: RequirementResponseKind.evidence,
        evidenceId: input.evidenceId,
      });
    }
    if (input.sourceType === 'official_event' && input.eventId) {
      assertNoDuplicateVolunteerEvent(application.requirementResponses, input.eventId);
    }

    return prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.volunteer,
          requirementKey: input.requirementKey,
          responseKind:
            input.sourceType === 'official_event'
              ? RequirementResponseKind.official_event
              : RequirementResponseKind.evidence,
          evidence: input.evidenceId ? { connect: { id: input.evidenceId } } : undefined,
          payloadJson: toJsonValue({
            id: randomUUID(),
            applicationId: application.id,
            requirementKey: input.requirementKey,
            activityType: input.activityType,
            activityName: input.activityName,
            organizer: input.organizer ?? null,
            organizerLevel: input.organizerLevel ?? null,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            declaredValue: input.declaredValue ?? null,
            declaredUnit: input.declaredUnit,
            convertedValue:
              input.sourceType === 'official_event' ? (input.convertedValue ?? null) : null,
            convertedUnit: input.convertedUnit ?? (input.requirementKey === 'activity_count' ? 'event' : 'day'),
            conversionSource:
              input.sourceType === 'official_event'
                ? (input.conversionSource ?? 'event_registry')
                : null,
            sourceType: input.sourceType,
            evidenceId: input.evidenceId ?? null,
            eventId: input.eventId ?? null,
            workspaceId: application.workspaceId,
          }),
          status:
            input.sourceType === 'official_event'
              ? RequirementResponseStatus.verified
              : RequirementResponseStatus.needs_verification,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async addVolunteerPathEvidence(
    user: AuthenticatedUser,
    applicationId: string,
    input: AddVolunteerPathEvidenceInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.volunteer);
    await this.assertRequirementKey(application, Criterion.volunteer, input.requirementKey);
    await this.assertLinkedRecords(application, {
      responseKind:
        input.sourceType === 'official_event'
          ? RequirementResponseKind.official_event
          : RequirementResponseKind.evidence,
      evidenceId: input.evidenceId,
    });

    return prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.volunteer,
          requirementKey: input.requirementKey,
          responseKind:
            input.sourceType === 'official_event'
              ? RequirementResponseKind.official_event
              : RequirementResponseKind.evidence,
          evidence: { connect: { id: input.evidenceId } },
          payloadJson: toJsonValue({
            ...(input.payloadJson ?? {}),
            evidenceType: input.requirementKey,
            volunteerPath: input.requirementKey,
            sourceType: input.sourceType,
          }),
          status: RequirementResponseStatus.needs_verification,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async addIntegrationPathResponse(
    user: AuthenticatedUser,
    applicationId: string,
    input: AddIntegrationPathResponseInput,
  ) {
    const application = await this.getApplication(applicationId);
    await this.assertCanMutateResponse(user, application, Criterion.integration);
    await this.assertRequirementKey(application, Criterion.integration, input.requirementKey);
    if (input.evidenceId) {
      await this.assertLinkedRecords(application, {
        responseKind: RequirementResponseKind.evidence,
        evidenceId: input.evidenceId,
      });
    }

    const responseKind =
      input.sourceType === 'official_event'
        ? RequirementResponseKind.official_event
        : input.evidenceId
          ? RequirementResponseKind.evidence
          : RequirementResponseKind.system_confirmation;
    const status =
      input.sourceType === 'official_event'
        ? RequirementResponseStatus.verified
        : input.evidenceId
          ? RequirementResponseStatus.needs_verification
          : RequirementResponseStatus.declared;

    return prisma.$transaction(async (tx) => {
      const saved = await this.repository.createResponse(
        {
          workspace: { connect: { id: application.workspaceId } },
          application: { connect: { id: application.id } },
          criterion: Criterion.integration,
          requirementKey: input.requirementKey,
          responseKind,
          evidence: input.evidenceId ? { connect: { id: input.evidenceId } } : undefined,
          payloadJson: toJsonValue({
            ...input.payloadJson,
            evidenceType: input.requirementKey,
            integrationPath: input.requirementKey,
            sourceType: input.sourceType,
            evidenceId: input.evidenceId ?? null,
            workspaceId: application.workspaceId,
          }),
          status,
          creator: { connect: { id: user.id } },
        },
        tx,
      );
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_CREATED,
        targetType: 'requirement_response',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: toJsonValue(saved),
      });
      return saved;
    });
  }

  async deleteResponse(user: AuthenticatedUser, responseId: string) {
    const existing = await this.getResponse(responseId);
    await this.assertCanMutateResponse(user, existing.application, existing.criterion);

    await prisma.$transaction(async (tx) => {
      await this.repository.deleteResponse(existing.id, tx);
      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: existing.workspaceId,
        action: auditActions.REQUIREMENT_RESPONSE_DELETED,
        targetType: 'requirement_response',
        targetId: existing.id,
        applicationId: existing.applicationId,
        beforeStateJson: toJsonValue(existing),
      });
    });

    return { deleted: true };
  }

  private async getApplication(applicationId: string): Promise<CompletionApplication> {
    const application = await this.repository.findApplicationContext(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }

  private async getResponse(responseId: string) {
    const response = await this.repository.findResponseById(responseId);
    if (!response) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Requirement response not found');
    }
    return response;
  }

  private async assertCanMutateResponse(
    user: AuthenticatedUser,
    application: Application & { student: User },
    criterion: Criterion,
  ) {
    assertSameWorkspace(user, application, 'Application not found');
    if (user.role === Role.admin || user.role === Role.manager) return;
    if (application.studentId === user.id) {
      if (isEditableStatus(application.status)) return;
      const hasSupplementTask = await prisma.reviewTask.findFirst({
        where: {
          applicationId: application.id,
          criterion,
          status: 'supplement_required',
        },
      });
      if (hasSupplementTask) return;
    }
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Cannot change requirement responses');
  }

  private async assertRequirementKey(
    application: Pick<Application, 'workspaceId' | 'schoolYear' | 'targetLevel'>,
    criterion: Criterion,
    requirementKey: string,
  ) {
    const criteria = await loadCriteriaRules({
      workspaceId: application.workspaceId,
      schoolYear: application.schoolYear,
      level: application.targetLevel,
    });
    const groups = buildRequirementGroupsByCriterion(criteria.rules)[criterion] ?? [];
    const keys = new Set(groups.flatMap((group) => group.requirements.map((item) => item.key)));
    if (!keys.has(requirementKey)) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_RULE_CONFIG,
        'requirementKey does not belong to application criteria version',
      );
    }
  }

  private async assertLinkedRecords(
    application: Pick<Application, 'id'>,
    input: {
      criterion?: Criterion;
      requirementKey?: string;
      responseKind: RequirementResponseKind;
      metricId?: string | null;
      evidenceId?: string | null;
      status?: unknown;
    },
  ) {
    if (input.metricId) {
      const metric = await prisma.applicationMetric.findUnique({ where: { id: input.metricId } });
      if (!metric || metric.applicationId !== application.id) {
        throw new AppError(400, ErrorCodes.METRIC_NOT_FOUND, 'Metric is not linked to application');
      }
    }
    if (input.evidenceId) {
      const evidence = await prisma.evidence.findUnique({ where: { id: input.evidenceId } });
      if (!evidence || evidence.applicationId !== application.id) {
        throw new AppError(
          400,
          ErrorCodes.EVIDENCE_NOT_FOUND,
          'Evidence is not linked to application',
        );
      }
    }
    if (input.responseKind === RequirementResponseKind.metric && !input.metricId) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'metricId is required');
    }
    if (
      (input.responseKind === RequirementResponseKind.evidence ||
        input.responseKind === RequirementResponseKind.official_event) &&
      !input.evidenceId
    ) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'evidenceId is required');
    }
  }

  private supersedePhysicalResponses(tx: Prisma.TransactionClient, applicationId: string) {
    return tx.applicationRequirementResponse.updateMany({
      where: {
        applicationId,
        criterion: Criterion.physical,
        requirementKey: { in: physicalRequirementKeys },
        status: { not: RequirementResponseStatus.superseded },
      },
      data: {
        status: RequirementResponseStatus.superseded,
      },
    });
  }
}

function buildSummary(items: CriterionCompletionDto[]) {
  return {
    notStarted: items.filter((item) => item.status === 'not_started').length,
    inProgress: items.filter((item) => item.status === 'in_progress').length,
    needsVerification: items.filter((item) => item.status === 'needs_verification').length,
    readyForPrecheck: items.filter((item) => item.status === 'ready_for_precheck').length,
    accepted: items.filter((item) => item.status === 'accepted').length,
  };
}

function isEditableStatus(status: ApplicationStatus): boolean {
  const editableStatuses: ApplicationStatus[] = [
    ApplicationStatus.draft,
    ApplicationStatus.prechecked,
    ApplicationStatus.ready_to_submit,
    ApplicationStatus.supplement_required,
  ];
  return editableStatuses.includes(status);
}

export function assertRequirementStatusMutationAllowed(
  user: Pick<AuthenticatedUser, 'role'>,
  requirementKey: string,
  status?: RequirementResponseStatus,
  responseKind?: RequirementResponseKind,
) {
  if (
    requirementKey === 'no_violation' &&
    (responseKind === RequirementResponseKind.system_confirmation ||
      status === RequirementResponseStatus.verified ||
      status === RequirementResponseStatus.rejected) &&
    user.role !== Role.officer &&
    user.role !== Role.manager &&
    user.role !== Role.admin
  ) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students cannot confirm no_violation');
  }
  if (
    requirementKey === 'no_f_grade' &&
    (status === RequirementResponseStatus.verified ||
      status === RequirementResponseStatus.rejected) &&
    user.role !== Role.officer &&
    user.role !== Role.manager &&
    user.role !== Role.admin
  ) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Students cannot verify no_f_grade');
  }
}

function responseStatusForMetric(status: VerificationStatus): RequirementResponseStatus {
  if (status === VerificationStatus.verified) return RequirementResponseStatus.verified;
  if (status === VerificationStatus.rejected) return RequirementResponseStatus.rejected;
  if (status === VerificationStatus.pending) return RequirementResponseStatus.needs_verification;
  return RequirementResponseStatus.declared;
}

export function assertNoDuplicateVolunteerEvent(
  responses: Array<{ criterion: Criterion; requirementKey: string; payloadJson: unknown }>,
  eventId: string,
) {
  const exists = responses.some((response) => {
    if (response.criterion !== Criterion.volunteer) return false;
    if (!volunteerActivityRequirementKeys.includes(response.requirementKey)) return false;
    const payload = response.payloadJson;
    return (
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).eventId === eventId
    );
  });
  if (exists) {
    throw new AppError(
      409,
      ErrorCodes.VALIDATION_ERROR,
      'Volunteer event has already been imported for this application',
    );
  }
}
