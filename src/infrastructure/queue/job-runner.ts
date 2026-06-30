import { randomUUID } from 'node:crypto';
import type { JobRecord, JobRepository } from './job.repository';

export class InMemoryJobRepository implements JobRepository {
  private readonly jobs: JobRecord[] = [];

  async enqueue<TPayload>(type: string, payload: TPayload): Promise<JobRecord<TPayload>> {
    const job: JobRecord<TPayload> = {
      id: randomUUID(),
      type,
      payload,
      status: 'queued',
      createdAt: new Date(),
    };

    this.jobs.push(job);
    return job;
  }
}

export class JobRunner {
  // Durable queues will replace this placeholder when async workflows are introduced.
  constructor(private readonly repository: JobRepository = new InMemoryJobRepository()) {}

  enqueue<TPayload>(type: string, payload: TPayload): Promise<JobRecord<TPayload>> {
    return this.repository.enqueue(type, payload);
  }
}
