import { EventStatus, Role, WorkspaceType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { EventRegistryService } from '../../src/modules/event-registry/event-registry.service';

const schoolId = '11111111-1111-4111-8111-111111111111';
const cityId = '22222222-2222-4222-8222-222222222222';
const cityEvent = {
  id: 'event-city',
  workspaceId: cityId,
  workspace: { type: WorkspaceType.CITY, isActive: true },
  eventName: 'City event',
  criterion: 'volunteer',
  organizer: 'City',
  organizerLevel: 'city',
  startDate: null,
  endDate: null,
  convertedValue: null,
  convertedUnit: null,
  eligibleLevelsJson: null,
  participantCount: 10,
  rosterIndexed: true,
  status: EventStatus.active,
  eventFiles: [{ id: 'roster-link', file: { id: 'roster-file', filePath: '/private/roster.xlsx' } }],
  sampleCertificateFile: { id: 'certificate-file', filePath: '/private/certificate.pdf' },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

const student = {
  id: 'student-1', email: 'student@school.test', role: Role.student, fullName: 'Student',
  studentCode: 'S-1', className: null, faculty: null, avatarUrl: null, workspaceId: schoolId,
  workspace: { id: schoolId, code: 'DUT', type: WorkspaceType.SCHOOL, name: 'DUT', shortName: 'DUT' },
};

describe('student access to City event registry', () => {
  it('keeps City event roster and certificate file metadata out of student details', async () => {
    const repository = { findById: vi.fn().mockResolvedValue(cityEvent) };
    const result = await new EventRegistryService(repository as never, {} as never, {} as never)
      .getDetail(student, cityEvent.id);

    expect(result).toMatchObject({ eventFiles: [], sampleCertificateFile: null });
  });

  it('keeps City event file metadata out of student event lists', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({ items: [cityEvent], total: 1 }),
    };
    const result = await new EventRegistryService(repository as never, {} as never, {} as never)
      .list(student, { page: 1, limit: 10 } as never);

    expect(result.items[0]).toMatchObject({ eventFiles: [], sampleCertificateFile: null });
  });

  it('keeps event file metadata available to City staff', async () => {
    const repository = { findById: vi.fn().mockResolvedValue(cityEvent) };
    const cityManager = {
      ...student,
      id: 'city-manager-1',
      role: Role.city_manager,
      workspaceId: cityId,
      workspace: {
        id: cityId,
        code: 'DANANG_CITY',
        type: WorkspaceType.CITY,
        name: 'Đà Nẵng',
        shortName: 'Đà Nẵng',
      },
    };
    const result = await new EventRegistryService(repository as never, {} as never, {} as never)
      .getDetail(cityManager, cityEvent.id);

    expect(result).toMatchObject({
      eventFiles: cityEvent.eventFiles,
      sampleCertificateFile: cityEvent.sampleCertificateFile,
    });
  });
});
