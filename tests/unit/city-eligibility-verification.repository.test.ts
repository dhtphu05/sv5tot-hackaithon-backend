import { Role } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CitySubmissionEligibilityRepository } from '../../src/modules/applications/city-submission-eligibility.repository';

describe('CitySubmissionEligibilityRepository manual verification audit', () => {
  it('stores one current decision and writes minimal audit metadata in the same transaction', async () => {
    const verification = {
      id: 'verification-a',
      applicationId: 'application-a',
      decision: 'APPROVED',
      reason: 'Checked the official signed decision.',
      decidedById: 'city-manager',
      decidedAt: new Date('2026-09-01T00:00:00.000Z'),
    };
    const tx = {
      applicationEligibilityVerification: {
        upsert: vi.fn().mockResolvedValue(verification),
      },
      application: {
        findUnique: vi.fn().mockResolvedValue({ workspaceId: 'school-a' }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'application-a', updatedAt: new Date('2026-09-01T00:00:00.000Z') },
      ]),
    };
    const db = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const repository = new CitySubmissionEligibilityRepository(db as never);
    const lockedUpdatedAt = new Date('2026-09-01T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(lockedUpdatedAt);

    await repository.saveVerification({
      applicationId: 'application-a',
      decision: 'APPROVED',
      reason: 'Checked the official signed decision.',
      verificationBasisHash: 'a'.repeat(64),
      actorId: 'city-manager',
      actorRole: Role.city_manager,
    } as never);

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-a' },
      data: { updatedAt: expect.any(Date) },
    });
    expect(tx.application.update.mock.calls[0][0].data.updatedAt.getTime()).toBeGreaterThan(
      lockedUpdatedAt.getTime(),
    );
    expect(tx.applicationEligibilityVerification.upsert).toHaveBeenCalledWith({
      where: { applicationId: 'application-a' },
      create: {
        applicationId: 'application-a',
        decision: 'APPROVED',
        reason: 'Checked the official signed decision.',
        verificationBasisHash: 'a'.repeat(64),
        decidedById: 'city-manager',
        decidedAt: expect.any(Date),
      },
      update: {
        decision: 'APPROVED',
        reason: 'Checked the official signed decision.',
        verificationBasisHash: 'a'.repeat(64),
        decidedById: 'city-manager',
        decidedAt: expect.any(Date),
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'city-manager',
        actorRole: Role.city_manager,
        action: 'APPLICATION_ELIGIBILITY_VERIFICATION_APPROVED',
        targetType: 'application_eligibility_verification',
        targetId: 'verification-a',
        applicationId: 'application-a',
        workspaceId: 'school-a',
        metadataJson: { applicationId: 'application-a', decision: 'APPROVED' },
        afterStateJson: { decision: 'APPROVED' },
      }),
    });
    const auditData = tx.auditLog.create.mock.calls[0][0].data;
    expect(auditData.metadataJson).not.toHaveProperty('reason');
    expect(auditData.afterStateJson).not.toHaveProperty('reason');
    expect(auditData.note).toBeUndefined();
    vi.useRealTimers();
  });

  it('does not save or audit a verification after the application leaves the pre-submit state', async () => {
    const tx = {
      applicationEligibilityVerification: { upsert: vi.fn() },
      application: { findUnique: vi.fn() },
      auditLog: { create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const db = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const repository = new CitySubmissionEligibilityRepository(db as never);

    await expect(
      repository.saveVerification({
        applicationId: 'application-a',
        decision: 'APPROVED',
        reason: 'Checked the official signed decision.',
        verificationBasisHash: 'a'.repeat(64),
        actorId: 'city-manager',
        actorRole: Role.city_manager,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(tx.applicationEligibilityVerification.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
