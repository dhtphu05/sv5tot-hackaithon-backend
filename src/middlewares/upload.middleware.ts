import multer from 'multer';
import { uploadConfig } from '../config/upload';
import { AppError } from '../shared/errors/app-error';
import { ErrorCodes } from '../shared/errors/error-codes';

export const allowedUploadMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: uploadConfig.maxFileSizeBytes,
  },
  fileFilter(_req, file, callback) {
    if (!allowedUploadMimeTypes.includes(file.mimetype)) {
      callback(new AppError(400, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 'File type is not allowed'));
      return;
    }

    callback(null, true);
  },
});
