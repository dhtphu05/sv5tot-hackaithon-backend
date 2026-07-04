import path from 'node:path';
import type {
  AdministrativeDocResult,
  SmartReaderAdapter,
  SmartReaderAsyncResult,
  SmartReaderCancelResult,
  SmartReaderOcrResult,
  SmartReaderUploadResult,
} from './smartreader.types';

export class MockSmartReaderAdapter implements SmartReaderAdapter {
  async uploadFile(input: {
    filePath: string;
    originalName?: string;
    title?: string;
    description?: string;
  }): Promise<SmartReaderUploadResult> {
    const fileName = input.originalName ?? path.basename(input.filePath);
    return {
      hash: `mock-${Buffer.from(fileName).toString('hex').slice(0, 24)}`,
      fileType: path.extname(fileName).replace('.', '') || 'pdf',
      fileName,
      tokenId: 'mock-token-id',
      raw: {
        message: 'IDG-00000000',
        statusCode: 200,
        object: { provider: 'mock-smartreader', fileName },
      },
    };
  }

  async ocrBasic(): Promise<SmartReaderOcrResult> {
    return mockOcrResult('basic');
  }

  async ocrAdvanced(): Promise<SmartReaderOcrResult> {
    return mockOcrResult('advanced');
  }

  async startAdvancedAsync(): Promise<{
    sessionId: string;
    status: 'started';
    warnings: string[];
    warningMessages: string[];
    raw: unknown;
  }> {
    return {
      sessionId: 'mock-session-001',
      status: 'started',
      warnings: [],
      warningMessages: [],
      raw: {
        message: 'IDG-00000000',
        statusCode: 200,
        object: { session_id: 'mock-session-001' },
      },
    };
  }

  async getAdvancedAsyncResult(sessionId: string): Promise<SmartReaderAsyncResult> {
    return {
      ...mockOcrResult('async'),
      sessionId,
      status: 'completed',
      progressProcessedPages: 2,
      progressRemainingPages: 0,
      resultLink: undefined,
    };
  }

  async cancelAdvancedAsync(sessionId: string): Promise<SmartReaderCancelResult> {
    return {
      sessionId,
      status: 'cancelled',
      warnings: [],
      warningMessages: [],
      raw: {
        message: 'IDG-00000000',
        statusCode: 200,
        object: { session_id: sessionId, status: 'cancelled' },
      },
    };
  }

  async extractAdministrativeDocument(): Promise<AdministrativeDocResult> {
    return {
      fields: {
        co_quan_ban_hanh: 'Hoi Sinh vien Truong Dai hoc Bach khoa',
        so_ky_hieu: '01/QD-HSV',
        loai_van_ban: 'Quyet dinh',
        trich_yeu: 'Cong nhan danh sach sinh vien tham gia chien dich tinh nguyen',
        ngay_ban_hanh: '2026-06-15',
        nguoi_ky: 'Nguyen Van A',
      },
      text:
        'Quyet dinh ve viec cong nhan danh sach sinh vien tham gia chien dich tinh nguyen nam 2026.',
      warnings: [],
      warningMessages: [],
      raw: {
        message: 'IDG-00000000',
        statusCode: 200,
        object: { provider: 'mock-smartreader', type: 'administrative_document' },
      },
    };
  }
}

function mockOcrResult(mode: string): SmartReaderOcrResult {
  return {
    text:
      'Giay chung nhan sinh vien 5 tot. Sinh vien Nguyen Van Sinh tham gia Mua he xanh 2026.',
    lines: [
      { text: 'Giay chung nhan sinh vien 5 tot', confidence: 0.97, page: 1 },
      { text: 'Nguyen Van Sinh - 102220001', confidence: 0.95, page: 1 },
    ],
    paragraphs: [
      {
        text: 'Sinh vien Nguyen Van Sinh da tham gia hoat dong tinh nguyen Mua he xanh 2026.',
        confidence: 0.94,
        page: 1,
      },
    ],
    tables: [
      {
        page: 2,
        confidence: 0.91,
        rows: [
          ['STT', 'Ho ten', 'MSSV'],
          ['1', 'Nguyen Van Sinh', '102220001'],
        ],
      },
    ],
    warnings: mode === 'advanced' ? ['mock_table_detected'] : [],
    warningMessages: mode === 'advanced' ? ['Mock detected one table for offline testing'] : [],
    numOfPages: 2,
    raw: {
      message: 'IDG-00000000',
      statusCode: 200,
      object: { provider: 'mock-smartreader', mode },
    },
  };
}
