import { describe, expect, it } from 'vitest';
import { SmartReaderResponseError } from '../../src/modules/smartreader/smartreader.errors';
import { mapAsyncResultResponse } from '../../src/modules/smartreader/smartreader.mapper';

describe('SmartReader async result mapper', () => {
  it('maps completed response from object.link', () => {
    const result = mapAsyncResultResponse('session-1', {
      status: 'OK',
      statusCode: 200,
      message: 'IDG-00000000',
      object: {
        warnings: [],
        warning_messages: [],
        num_of_pages: 1,
        link: 'https://example.test/result.json',
      },
    });

    expect(result.status).toBe('completed');
    expect(result.resultLink).toBe('https://example.test/result.json');
    expect(result.numOfPages).toBe(1);
    expect(result.processedPages).toBe(1);
    expect(result.remainingPages).toBe(0);
  });

  it('maps pending response from object.warning', () => {
    const result = mapAsyncResultResponse('session-2', {
      status: 'OK',
      statusCode: 200,
      message: 'IDG-00000000',
      object: {
        warning: ['request_dang_trong_qua_trinh_xu_ly'],
        warning_messages: ['Request đang trong quá trình xử lý.'],
        num_of_pages: 0,
        num_of_processed_page: 3,
        num_of_remaining_pages: 42,
      },
    });

    expect(result.status).toBe('processing');
    expect(result.processedPages).toBe(3);
    expect(result.remainingPages).toBe(42);
    expect(result.warningMessages).toEqual(['Request đang trong quá trình xử lý.']);
  });

  it('maps pending response from object.warnings', () => {
    const result = mapAsyncResultResponse('session-3', {
      status: 'OK',
      statusCode: 200,
      message: 'IDG-00000000',
      object: {
        warnings: ['request_dang_trong_qua_trinh_xu_ly'],
        num_of_processed_page: 5,
        num_of_remaining_pages: 8,
      },
    });

    expect(result.status).toBe('processing');
    expect(result.processedPages).toBe(5);
    expect(result.remainingPages).toBe(8);
  });

  it('maps OK response without known async markers as unknown_ok_response', () => {
    const result = mapAsyncResultResponse('session-4', {
      status: 'OK',
      statusCode: 200,
      message: 'IDG-00000000',
      object: {
        total_sessions: 1,
      },
    });

    expect(result.status).toBe('unknown_ok_response');
    expect(result.objectKeys).toEqual(['total_sessions']);
  });

  it('throws redacted AppError for failed provider response', () => {
    expect(() =>
      mapAsyncResultResponse('session-5', {
        status: 'ERROR',
        statusCode: 500,
        message: 'IDG-99999999',
        object: {},
      }),
    ).toThrow(SmartReaderResponseError);
  });
});
