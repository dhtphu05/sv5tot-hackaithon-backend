import { Criterion } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { coreCriteria } from '../../src/shared/constants/criteria';
import { coreCriteria as rulesCoreCriteria } from '../../src/modules/rules/criteria.constants';

describe('Staff Lane core criteria contract', () => {
  it('defines exactly the five individual City criteria', () => {
    expect(coreCriteria).toEqual([
      Criterion.ethics,
      Criterion.academic,
      Criterion.physical,
      Criterion.volunteer,
      Criterion.integration,
    ]);
    expect(coreCriteria).not.toContain(Criterion.priority);
    expect(coreCriteria).not.toContain(Criterion.collective);
  });

  it('keeps the existing rules-module source compatible', () => {
    expect(rulesCoreCriteria).toBe(coreCriteria);
  });
});
