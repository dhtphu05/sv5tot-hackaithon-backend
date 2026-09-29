import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';

export type EventRosterFormat = 'csv' | 'xlsx' | 'pdf';

export function getEventRosterFormat(originalName: string, mimeType: string): EventRosterFormat {
  const extension = originalName.toLowerCase().slice(originalName.lastIndexOf('.'));
  if (extension === '.xls' || mimeType === 'application/vnd.ms-excel') {
    throw new AppError(415, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 'Event roster supports CSV, XLSX, and PDF files only');
  }
  if (mimeType === 'text/csv' && extension === '.csv') return 'csv';
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
    extension === '.xlsx'
  ) return 'xlsx';
  if (mimeType === 'application/pdf' && extension === '.pdf') return 'pdf';
  throw new AppError(415, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 'Event roster supports CSV, XLSX, and PDF files only');
}
