// Owns file metadata and storage integration boundaries.
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export class FilesRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findById(id: string) {
    return this.db.file.findUnique({
      where: { id },
      include: {
        workspace: { select: { type: true, isActive: true } },
        evidenceFiles: {
          include: {
            evidence: {
              include: {
                application: {
                  include: {
                    student: true,
                    reviewTasks: {
                      include: { evidences: { select: { evidenceId: true } } },
                    },
                    workspace: { select: { type: true, isActive: true } },
                  },
                },
                collectiveProfile: {
                  include: {
                    reviewTasks: {
                      include: { evidences: { select: { evidenceId: true } } },
                    },
                    workspace: { select: { type: true, isActive: true } },
                  },
                },
              },
            },
          },
        },
        eventFiles: {
          include: {
            event: {
              select: { workspaceId: true, workspace: { select: { type: true, isActive: true } } },
            },
          },
        },
        decisionImports: {
          select: { workspaceId: true },
        },
        awardDecisionsAsDecisionFile: {
          select: { issuerWorkspaceId: true },
        },
        awardDecisionsAsRosterFile: {
          select: { issuerWorkspaceId: true },
        },
        sampleCertificateEvents: {
          select: { workspaceId: true },
        },
      },
    });
  }
}
