import { Level, Role, type Application } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';

export const STUDENT_CITY_ONLY_SUBMISSION_MESSAGE =
  'Hồ sơ này không ở cấp Thành phố nên hiện không thể nộp. Hệ thống chỉ tiếp nhận hồ sơ cấp Thành phố; vui lòng liên hệ cán bộ quản lý để được hướng dẫn xử lý hồ sơ cũ.';

export function assertStudentApplicationIsCity(
  user: AuthenticatedUser,
  application: Pick<Application, 'targetLevel'>,
): void {
  if (user.role !== Role.student || application.targetLevel === Level.city) return;

  throw new AppError(
    409,
    ErrorCodes.APPLICATION_NOT_SUBMITTABLE,
    STUDENT_CITY_ONLY_SUBMISSION_MESSAGE,
  );
}
