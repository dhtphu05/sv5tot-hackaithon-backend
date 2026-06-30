import path from 'node:path';

export function resolveUploadPath(uploadDir: string, fileName: string): string {
  return path.resolve(uploadDir, fileName);
}
