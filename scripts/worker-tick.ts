import { prisma } from '../src/infrastructure/database/prisma';
import { JobsService } from '../src/modules/jobs/jobs.service';

async function main(): Promise<void> {
  const service = new JobsService();
  const result = await service.runWorkerTick();
  if (!result.job) {
    console.log('worker tick processed=0');
    return;
  }

  console.log(
    `worker tick processed=1 jobId=${result.job.id} status=${result.job.status} type=${result.job.jobType}`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
