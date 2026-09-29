import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadStoredObject } from '../../src/modules/storage/storage-download';

describe('stored object download timeout behavior', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bounds signed-URL downloads and returns the response bytes', async () => {
    const bytes = Buffer.from('fixture');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadStoredObject('https://storage.test/signed')).resolves.toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledWith('https://storage.test/signed', {
      signal: expect.any(AbortSignal),
    });
  });

  it('maps network and HTTP failures to retryable storage errors without exposing URL details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket details')));
    await expect(downloadStoredObject('https://storage.test/secret')).rejects.toMatchObject({
      statusCode: 502,
      code: 'STORAGE_ERROR',
      message: 'Stored document download failed',
      details: { retryable: true },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(downloadStoredObject('https://storage.test/secret')).rejects.toMatchObject({
      statusCode: 502,
      code: 'STORAGE_ERROR',
      details: { retryable: true },
    });
  });
});
