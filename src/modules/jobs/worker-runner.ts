import { logger } from '../../config/logger';
import { JobsService } from './jobs.service';

type JobWorkerRunner = {
  stop: () => void;
};

export function startJobWorkerLoop(
  options: {
    enabled: boolean;
    intervalMs: number;
    service?: JobsService;
  },
): JobWorkerRunner {
  const service = options.service ?? new JobsService();
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = () => {
    if (stopped || !options.enabled) return;
    timer = setTimeout(() => {
      void tick();
    }, options.intervalMs);
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;

    try {
      const result = await service.runWorkerTick();
      if (result.job) {
        logger.info(
          {
            jobId: result.job.id,
            jobType: result.job.jobType,
            status: result.job.status,
          },
          'Background job worker processed a queued job',
        );
      }
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Background job worker tick failed',
      );
    } finally {
      running = false;
      schedule();
    }
  };

  if (options.enabled) {
    logger.info({ intervalMs: options.intervalMs }, 'Background job worker started');
    void tick();
  } else {
    logger.info('Background job worker disabled');
  }

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
