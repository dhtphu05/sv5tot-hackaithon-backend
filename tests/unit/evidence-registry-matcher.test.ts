import { Criterion } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  eventRegistry: { findFirst: vi.fn() },
  eventParticipant: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: prismaMock,
}));

import { matchEvidenceRegistry } from '../../src/modules/evidences/evidence-registry-matcher';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const event = {
  id: 'event-1',
};

describe('matchEvidenceRegistry participant name matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.eventRegistry.findFirst.mockResolvedValue(event);
    prismaMock.eventParticipant.findFirst.mockResolvedValue(null);
  });

  it('matches a unique normalized student name without studentCode', async () => {
    prismaMock.eventParticipant.findMany.mockResolvedValue([
      { id: 'participant-1', studentName: 'Nguyen Van Sinh' },
    ]);

    const result = await matchEvidenceRegistry(
      Criterion.volunteer,
      {
        event_name: 'Mua he xanh',
        student_name: 'Nguyen Van Sinh',
      },
      workspaceId,
    );

    expect(result).toMatchObject({
      eventId: 'event-1',
      participantId: 'participant-1',
      warnings: [],
    });
    expect(prismaMock.eventParticipant.findFirst).not.toHaveBeenCalled();
  });

  it('does not auto match when the normalized student name is duplicated', async () => {
    prismaMock.eventParticipant.findMany.mockResolvedValue([
      { id: 'participant-1', studentName: 'Nguyen Van Sinh' },
      { id: 'participant-2', studentName: 'Nguyen Van Sinh' },
    ]);

    const result = await matchEvidenceRegistry(
      Criterion.volunteer,
      {
        event_name: 'Mua he xanh',
        student_name: 'Nguyen Van Sinh',
        student_code: '102220001',
      },
      workspaceId,
    );

    expect(result).toMatchObject({
      eventId: 'event-1',
      participantId: null,
      warnings: ['participant_name_duplicate'],
    });
    expect(prismaMock.eventParticipant.findFirst).not.toHaveBeenCalled();
  });

  it('prioritizes a unique name match over a different studentCode', async () => {
    prismaMock.eventParticipant.findMany.mockResolvedValue([
      { id: 'participant-by-name', studentName: 'Bui Quoc Anh' },
    ]);

    const result = await matchEvidenceRegistry(
      Criterion.academic,
      {
        event_name: 'Olympic',
        student_name: 'Bui Quoc Anh',
        student_code: '999999999',
      },
      workspaceId,
    );

    expect(result.participantId).toBe('participant-by-name');
    expect(prismaMock.eventParticipant.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to studentCode when there is no studentName', async () => {
    prismaMock.eventParticipant.findMany.mockResolvedValue([]);
    prismaMock.eventParticipant.findFirst.mockResolvedValue({ id: 'participant-by-code' });

    const result = await matchEvidenceRegistry(
      Criterion.integration,
      {
        event_name: 'IELTS',
        student_code: '102220001',
      },
      workspaceId,
    );

    expect(result).toMatchObject({
      eventId: 'event-1',
      participantId: 'participant-by-code',
      warnings: [],
    });
  });
});
