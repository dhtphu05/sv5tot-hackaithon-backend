import type { Prisma } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

const APPLICATION_CANCELLED_MESSAGE = 'Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.';

export function assertApplicationNotCancelled(application: { cancelledAt: Date | null }): void {
  if (application.cancelledAt) throw applicationCancelledError();
}

export async function lockApplicationAndAssertNotCancelled(
  tx: Prisma.TransactionClient,
  applicationId: string,
): Promise<void> {
  if (await lockApplicationAndReadCancellationState(tx, applicationId)) {
    throw applicationCancelledError();
  }
}

export async function lockApplicationAndReadCancellationState(
  tx: Prisma.TransactionClient,
  applicationId: string,
): Promise<boolean> {
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
  return Boolean(application.cancelledAt);
}

function applicationCancelledError() {
  return new AppError(409, ErrorCodes.APPLICATION_CANCELLED, APPLICATION_CANCELLED_MESSAGE);
}
