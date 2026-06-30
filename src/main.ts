import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './infrastructure/database/prisma';
import { createApp } from './app';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, '5TOT Backend API started');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down HTTP server');

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
