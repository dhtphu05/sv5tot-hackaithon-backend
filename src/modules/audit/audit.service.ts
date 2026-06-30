// Owns immutable audit log querying for privileged users.
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export class AuditService {
  executePlaceholder(): never {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'Audit module is not implemented yet');
  }
}
