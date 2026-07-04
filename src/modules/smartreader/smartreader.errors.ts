import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { redactSmartReaderSecrets } from './smartreader.redactor';

export class SmartReaderError extends AppError {
  constructor(message: string, details?: unknown, statusCode = 502) {
    super(statusCode, ErrorCodes.SMARTREADER_REQUEST_FAILED, message, redactSmartReaderSecrets(details));
  }
}

export class SmartReaderResponseError extends AppError {
  constructor(message: string, details?: unknown, statusCode = 502) {
    super(statusCode, ErrorCodes.SMARTREADER_RESPONSE_INVALID, message, redactSmartReaderSecrets(details));
  }
}
