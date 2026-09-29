import { ApplicationStatus, ReviewTaskStatus, Role, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';

export class ApplicationSubmissionModeService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async assertGenericSubmitAllowed(user: AuthenticatedUser, applicationId: string): Promise<void> {
    const application = await this.db.application.findFirst({
      where: {
        id: applicationId,
        ...(user.role === Role.admin ? {} : { studentId: user.id }),
      },
      select: {
        status: true,
        submittedAt: true,
        reviewTasks: {
          where: { status: ReviewTaskStatus.supplement_required },
          select: { id: true, criterion: true },
        },
      },
    });

    if (
      application?.status !== ApplicationStatus.supplement_required ||
      application.submittedAt === null
    ) {
      return;
    }

    throw new AppError(
      409,
      ErrorCodes.APPLICATION_NOT_SUBMITTABLE,
      'Hồ sơ đang có yêu cầu bổ sung. Vui lòng gửi lại từng tiêu chí được yêu cầu bổ sung.',
      {
        supplementTasks: application.reviewTasks,
      },
    );
  }
}
