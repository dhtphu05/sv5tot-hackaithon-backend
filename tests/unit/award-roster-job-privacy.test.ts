import { JobStatus, JobType, Role, type IndexingJob } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { JobsService } from '../../src/modules/jobs/jobs.service';

const awardJob = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  jobType: JobType.award_roster_ingestion,
  targetId: '33333333-3333-4333-8333-333333333333',
  status: JobStatus.failed,
} as IndexingJob;

const actor = (role: Role) => ({ id: 'actor-1', role }) as never;

describe('Award indexing job privacy', () => {
  it.each([Role.data_uploader, Role.admin])('hides Award job details from the generic endpoint for %s', async (role) => {
    const repository = { findById: vi.fn().mockResolvedValue(awardJob) };
    const service = new JobsService(repository as never);

    await expect(service.getJob(actor(role), awardJob.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('prevents the generic run and retry endpoints from acting on Award jobs', async () => {
    const repository = { findById: vi.fn().mockResolvedValue(awardJob) };
    const service = new JobsService(repository as never);

    await expect(service.runJob(actor(Role.admin), awardJob.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.retryJob(actor(Role.admin), awardJob.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
