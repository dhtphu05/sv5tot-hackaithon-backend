import { env } from './env';

export const uploadConfig = {
  uploadDir: env.UPLOAD_DIR,
  maxFileSizeBytes: env.MAX_FILE_SIZE_MB * 1024 * 1024,
  storageDriver: env.STORAGE_DRIVER,
};
