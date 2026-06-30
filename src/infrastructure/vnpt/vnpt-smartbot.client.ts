import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export class VnptSmartBotClient {
  async sendMessage(): Promise<never> {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'VNPT SmartBot client is not implemented');
  }
}
