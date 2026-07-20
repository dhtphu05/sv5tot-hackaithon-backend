import path from 'node:path';

export interface UploadObjectParams {
  key: string;
  buffer: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface SaveFileParams {
  buffer: Buffer;
  originalName: string;
  mimeType?: string;
  applicationId?: string;
  evidenceId?: string;
  directory?: string;
}

export interface StoredObject {
  key: string;
  filePath: string;
  size: number;
  mimeType?: string;
  publicUrl: string | null;
}

export interface StorageAdapter {
  uploadObject(params: UploadObjectParams): Promise<void>;
  deleteObject(key: string): Promise<void>;
  getSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName);
  return baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 160);
}
