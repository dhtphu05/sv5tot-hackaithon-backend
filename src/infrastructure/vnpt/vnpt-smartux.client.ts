import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export class VnptSmartUxClient {
  async createExperienceEvent(): Promise<never> {
    throw new AppError(501, ErrorCodes.NOT_IMPLEMENTED, 'VNPT SmartUX client is not implemented');
  }
}
