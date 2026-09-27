import type { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

const APPLICATION_CANCELLED_MESSAGE =
  'Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.';

export async function lockApplicationAndAssertNotCancelled(
  tx: Prisma.TransactionClient,
  applicationId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string; cancelledAt: Date | null }>>`
    SELECT "id", "cancelledAt"
    FROM "Application"
    WHERE "id" = ${applicationId}::uuid
    FOR UPDATE
  `;

  const application = rows[0];
  if (!application) {
    throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
  }
  if (application.cancelledAt) {
    throw new AppError(409, ErrorCodes.APPLICATION_CANCELLED, APPLICATION_CANCELLED_MESSAGE);
  }
}
