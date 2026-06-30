// Owns SmartUX event ingestion and analytics dashboard boundaries.
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export class SmartUxService {
  executePlaceholder(): never {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'SmartUx module is not implemented yet');
  }
}
