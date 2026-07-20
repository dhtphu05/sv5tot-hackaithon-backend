import { Level } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  application: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: prismaMock,
}));

import { SmartbotHooksService } from '../../src/modules/smartbot-hooks/smartbot-hooks.service';

describe('SmartbotHooksService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns string-only Smartbot set_variables without raw student PII', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      workspaceId: '11111111-1111-4111-8111-111111111111',
    });
    prismaMock.application.findFirst.mockResolvedValue({
      id: '9a493741-8f06-43a2-8625-90c9a41f9df3',
      status: 'under_review',
      targetLevel: Level.city,
      schoolYear: '2025-2026',
      readinessScore: 72.4,
      evidences: [{ id: 'e1' }, { id: 'e2' }],
    });
    const service = new SmartbotHooksService();

    const result = await service.applicationStatus({
      user_id: '2e2031e8-bd75-4d93-9b7a-78a8f31f4e22',
      application_id: '9a493741-8f06-43a2-8625-90c9a41f9df3',
    });

    expect(result.success).toBe(true);
    expect(Object.values(result.set_variables).every((value) => typeof value === 'string')).toBe(true);
    expect(result.set_variables).toMatchObject({
      found: 'true',
      application_status: 'under_review',
      target_level: 'city',
      readiness_score: '72',
      evidence_count: '2',
    });
    expect(JSON.stringify(result.set_variables)).not.toContain('student');
  });
});
