import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

async function loadPolicy() {
  try {
    return await import('../../src/modules/applications/application-lifecycle.policy');
  } catch {
    return null;
  }
}

describe('application cancellation policy', () => {
  it('exports a row-lock guard for application-bound transactions', async () => {
    const policy = await loadPolicy();

    expect(policy).not.toBeNull();
    if (!policy) return;

    const queryRaw = vi.fn().mockResolvedValue([{ id: 'app-1', cancelledAt: null }]);
    await policy.lockApplicationAndAssertNotCancelled({ $queryRaw: queryRaw } as never, 'app-1');

    expect(queryRaw).toHaveBeenCalledOnce();
    const [query, applicationId] = queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(query.join('')).toContain('FOR UPDATE');
    expect(applicationId).toBe('app-1');
  });

  it('allows active and archived rows but rejects cancelled rows with the stable 409 contract', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    const active = vi.fn().mockResolvedValue([{ id: 'app-1', cancelledAt: null }]);
    await expect(
      policy.lockApplicationAndAssertNotCancelled({ $queryRaw: active } as never, 'app-1'),
    ).resolves.toBeUndefined();

    const cancelledAt = new Date('2026-09-28T00:00:00.000Z');
    const cancelled = vi.fn().mockResolvedValue([{ id: 'app-1', cancelledAt }]);
    await expect(
      policy.lockApplicationAndAssertNotCancelled({ $queryRaw: cancelled } as never, 'app-1'),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
      message: 'Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.',
    } satisfies Partial<AppError>);
  });

  it('registers APPLICATION_CANCELLED as the shared error code', () => {
    expect(ErrorCodes.APPLICATION_CANCELLED).toBe('APPLICATION_CANCELLED');
  });
});
