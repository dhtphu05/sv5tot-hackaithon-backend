// Owns API response contracts for cascade review results.
import type { Level } from '@prisma/client';
import type { PrecheckEngineResult } from '../rules/precheck.engine';

export type CascadeReviewResponseDto = {
  applicationId: string;
  targetLevel: Level;
  suggestedLevel: Level | null;
  humanConfirmationRequired: true;
  levelResults: PrecheckEngineResult[];
  upgradeHints: PrecheckEngineResult[];
  nextBestAction: string;
  createdAt: Date;
};
