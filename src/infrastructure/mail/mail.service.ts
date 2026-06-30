import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export class MailService {
  async send(): Promise<never> {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'Mail service is not implemented');
  }
}
