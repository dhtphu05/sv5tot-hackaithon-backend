import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export type TransactionClient = Prisma.TransactionClient;

export function runInTransaction<T>(
  callback: (tx: TransactionClient) => Promise<T>,
  client: PrismaClient = prisma,
): Promise<T> {
  return client.$transaction(callback);
}
