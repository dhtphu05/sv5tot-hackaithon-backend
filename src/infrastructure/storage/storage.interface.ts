export type StoredFile = {
  key: string;
  filePath: string;
  size: number;
  mimeType?: string;
  publicUrl: string | null;
};

export interface StorageService {
  saveFile(input: {
    buffer: Buffer;
    originalName: string;
    mimeType?: string;
    applicationId?: string;
    evidenceId?: string;
    directory?: string;
  }): Promise<StoredFile>;
  deleteFile(filePath: string): Promise<void>;
  getPublicUrl(filePath: string): string | null;
}
