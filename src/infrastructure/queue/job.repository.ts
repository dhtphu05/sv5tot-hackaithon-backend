export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type JobRecord<TPayload = unknown> = {
  id: string;
  type: string;
  payload: TPayload;
  status: JobStatus;
  createdAt: Date;
};

export interface JobRepository {
  enqueue<TPayload>(type: string, payload: TPayload): Promise<JobRecord<TPayload>>;
}
