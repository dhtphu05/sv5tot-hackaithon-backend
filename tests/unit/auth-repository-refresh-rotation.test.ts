import { describe, expect, it, vi } from 'vitest';
import { AuthRepository } from '../../src/modules/auth/auth.repository';

describe('AuthRepository.rotateRefreshToken', () => {
  it('revokes the old token conditionally and creates its successor in one transaction', async () => {
    const tx = {
      refreshToken: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'successor' }),
      },
    };
    const db = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx),
      ),
    };
    const repository = new AuthRepository(db as never);

    await expect(
      repository.rotateRefreshToken('old-id', {
        userId: 'user-1',
        tokenHash: 'new-hash',
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).resolves.toBe(true);

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'old-id', revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(tx.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', tokenHash: 'new-hash' }),
    });
  });

  it('does not create a successor when another request already consumed the token', async () => {
    const tx = {
      refreshToken: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
      },
    };
    const db = {
      $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    };
    const repository = new AuthRepository(db as never);

    await expect(
      repository.rotateRefreshToken('old-id', {
        userId: 'user-1',
        tokenHash: 'new-hash',
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).resolves.toBe(false);
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
  });
});
