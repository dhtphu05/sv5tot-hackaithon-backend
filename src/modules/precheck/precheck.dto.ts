// Owns API response contracts for precheck results.
import type { Level } from '@prisma/client';
import type { CriterionResult, MissingItem } from '../rules/rules.types';

export type PrecheckResponseDto = {
  applicationId: string;
  level: Level;
  readinessScore: number;
  readyToSubmit: boolean;
  criteriaResults: CriterionResult[];
  missingItems: MissingItem[];
  warnings: string[];
  nextBestAction: string;
  humanConfirmationRequired: true;
  createdAt: Date;
};
