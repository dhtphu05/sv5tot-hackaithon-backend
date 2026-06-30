import { logger } from '../src/config/logger';

async function main(): Promise<void> {
  // Keep destructive database reset behind an explicit future implementation.
  logger.warn('reset-dev-db is not implemented for Phase 0');
}

void main();
