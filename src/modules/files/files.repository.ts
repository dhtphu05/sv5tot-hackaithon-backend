// Owns file metadata and storage integration boundaries.
import type { PrismaClient } from '@prisma/client';
import { Role } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export class FilesRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findActiveCityOfficerCriteria(officerId: string) {
    return this.db.officerSpecialization.findMany({
      where: {
        officerId,
        isActive: true,
        officer: { role: Role.city_officer, isActive: true },
      },
      select: { criterion: true },
    });
  }

  findByIdForCityOfficer(id: string) {
    return this.db.file.findUnique({
      where: { id },
      relationLoadStrategy: 'join',
      select: {
        id: true,
        ownerId: true,
        storageType: true,
        filePath: true,
        evidenceFiles: {
          select: {
            evidence: {
              select: {
                id: true,
                criterion: true,
                application: {
                  select: {
                    workspaceId: true,
                    applicationType: true,
                    targetLevel: true,
                    student: { select: { faculty: true } },
                    reviewTasks: {
                      select: {
                        criterion: true,
                        assignedOfficerId: true,
                        status: true,
                        evidences: { select: { evidenceId: true } },
                      },
                    },
                    workspace: { select: { type: true, isActive: true } },
                  },
                },
                collectiveProfile: {
                  select: {
                    workspaceId: true,
                    targetLevel: true,
                    representative: { select: { faculty: true } },
                    reviewTasks: {
                      select: {
                        criterion: true,
                        assignedOfficerId: true,
                        status: true,
                        evidences: { select: { evidenceId: true } },
                      },
                    },
                    workspace: { select: { type: true, isActive: true } },
                  },
                },
              },
            },
          },
        },
        eventFiles: {
          select: {
            event: { select: { workspaceId: true } },
          },
        },
        decisionImports: { select: { workspaceId: true } },
        sampleCertificateEvents: { select: { workspaceId: true } },
      },
    });
  }

  findOwnedById(id: string, ownerId: string) {
    return this.db.file.findUnique({
      where: { id, ownerId },
      select: {
        id: true,
        ownerId: true,
        storageType: true,
        filePath: true,
        publicUrl: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
      },
    });
  }

  findById(id: string) {
    return this.db.file.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        workspaceId: true,
        storageType: true,
        filePath: true,
        publicUrl: true,
        originalName: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
        workspace: { select: { type: true, isActive: true } },
        evidenceFiles: {
          select: {
            evidence: {
              select: {
                id: true,
                criterion: true,
                application: {
                  select: {
                    workspaceId: true,
                    applicationType: true,
                    targetLevel: true,
                    student: { select: { faculty: true } },
                    reviewTasks: {
                      select: {
                        criterion: true,
                        assignedOfficerId: true,
                        status: true,
                        evidences: { select: { evidenceId: true } },
                      },
                    },
                    workspace: { select: { type: true, isActive: true } },
                  },
                },
                collectiveProfile: {
                  select: {
                    workspaceId: true,
                    targetLevel: true,
                    representative: { select: { faculty: true } },
                    reviewTasks: {
                      select: {
                        criterion: true,
                        assignedOfficerId: true,
                        status: true,
                        evidences: { select: { evidenceId: true } },
                      },
                    },
                    workspace: { select: { type: true, isActive: true } },
                  },
                },
              },
            },
          },
        },
        eventFiles: {
          select: {
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
