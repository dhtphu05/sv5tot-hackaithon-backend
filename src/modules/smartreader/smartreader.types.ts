export type SmartReaderExporter = 'docx' | 'xlsx' | 'xlsx_nsheet' | 'json';

export type SmartReaderUploadResult = {
  hash: string;
  fileType: string;
  fileName?: string;
  tokenId?: string;
  raw: unknown;
};

export type SmartReaderTextLine = {
  text: string;
  confidence?: number;
  page?: number;
  bbox?: unknown;
};

export type SmartReaderParagraph = {
  text: string;
  confidence?: number;
  page?: number;
};

export type SmartReaderTable = {
  rows: unknown[];
  page?: number;
  confidence?: number;
};

export type SmartReaderOcrResult = {
  text: string;
  lines: SmartReaderTextLine[];
  paragraphs: SmartReaderParagraph[];
  tables: SmartReaderTable[];
  warnings: string[];
  warningMessages: string[];
  numOfPages?: number;
  raw: unknown;
};

export type SmartReaderAsyncStatus =
  | 'started'
  | 'processing'
  | 'completed'
  | 'completed_with_link'
  | 'failed'
  | 'cancelled'
  | 'unknown_ok_response'
  | 'unknown';

export type SmartReaderAsyncResult = SmartReaderOcrResult & {
  sessionId?: string;
  status: SmartReaderAsyncStatus;
  processedPages?: number | null;
  remainingPages?: number | null;
  progressProcessedPages?: number | null;
  progressRemainingPages?: number | null;
  resultLink?: string;
  objectKeys?: string[];
};

export type SmartReaderCancelResult = {
  sessionId: string;
  status: 'cancelled' | 'failed' | 'unknown';
  warnings: string[];
  warningMessages: string[];
  raw: unknown;
};

export type AdministrativeDocResult = {
  fields: {
    co_quan_ban_hanh?: string;
    so_ky_hieu?: string;
    loai_van_ban?: string;
    trich_yeu?: string;
    ngay_ban_hanh?: string;
    nguoi_ky?: string;
    [key: string]: unknown;
  };
  text: string;
  warnings: string[];
  warningMessages: string[];
  raw: unknown;
};

export interface SmartReaderAdapter {
  uploadFile(input: {
    filePath: string;
    originalName?: string;
    title?: string;
    description?: string;
  }): Promise<SmartReaderUploadResult>;

  ocrBasic(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
  }): Promise<SmartReaderOcrResult>;

  ocrAdvanced(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
    exporter?: SmartReaderExporter;
  }): Promise<SmartReaderOcrResult>;

  startAdvancedAsync(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
    exporter?: SmartReaderExporter;
  }): Promise<{
    sessionId: string;
    status?: 'started';
    warnings: string[];
    warningMessages: string[];
    raw: unknown;
  }>;

  getAdvancedAsyncResult(sessionId: string): Promise<SmartReaderAsyncResult>;

  cancelAdvancedAsync(sessionId: string): Promise<SmartReaderCancelResult>;

  extractAdministrativeDocument(input: {
    fileHash: string;
    fileType: string;
    details?: boolean;
  }): Promise<AdministrativeDocResult>;
}

export type VnptEnvelope = {
  message?: string;
  status?: string;
  statusCode?: number;
  object?: unknown;
  logID?: string;
  server_version?: string;
  [key: string]: unknown;
};
