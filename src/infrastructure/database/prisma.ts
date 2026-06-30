import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';

export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
});
