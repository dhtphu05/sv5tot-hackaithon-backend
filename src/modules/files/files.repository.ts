// Owns file metadata and storage integration boundaries.
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export class FilesRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findById(id: string) {
    return this.db.file.findUnique({ where: { id } });
  }
}
