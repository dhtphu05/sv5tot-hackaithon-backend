// Owns API response contracts for precheck results.
import type { Criterion, Level } from '@prisma/client';
import type { CriterionCompletionStatus, RequirementGroupDto } from '../criteria-completion/criteria-completion.types';

export type PrecheckNextActionDto = {
  type: string;
  label: string;
  shortReason: string;
  criterion?: Criterion;
  requirementKey?: string;
  evidenceId?: string;
  destination?: string;
  route: string;
  priority: number;
};

export type PrecheckMissingRequirementDto = {
  criterion: Criterion;
  requirementKey: string;
  title: string;
  status: string;
  reason: string;
  action?: PrecheckNextActionDto;
};

export type PrecheckCriterionResultDto = {
  criterion: Criterion;
  status: CriterionCompletionStatus;
  label: string;
  requirementGroups: RequirementGroupDto[];
  satisfiedRequirements: string[];
  missingRequirements: PrecheckMissingRequirementDto[];
  needsVerification: PrecheckMissingRequirementDto[];
  warnings: string[];
  nextAction: PrecheckNextActionDto | null;
  humanConfirmationRequired: true;
};

export type PrecheckResponseDto = {
  applicationId: string;
  level: Level;
  readinessScore: number;
  readyToSubmit: boolean;
  criteriaResults: PrecheckCriterionResultDto[];
  missingItems: PrecheckMissingRequirementDto[];
  warnings: string[];
  nextBestAction: string;
  nextAction: PrecheckNextActionDto | null;
  humanConfirmationRequired: true;
  createdAt: Date;
};
