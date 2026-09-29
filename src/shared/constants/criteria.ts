import { Criterion } from '@prisma/client';

export const criteria = {
  STUDY: 'study',
  ETHICS: 'ethics',
  FITNESS: 'fitness',
  VOLUNTEERING: 'volunteering',
  INTEGRATION: 'integration',
} as const;

export const coreCriteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
] as const;
