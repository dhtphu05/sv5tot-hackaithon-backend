import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorageService } from '../../src/infrastructure/storage/local-storage.service';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

describe('LocalStorageService', () => {
  it('stores export file keys with portable forward slashes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), '5tot-storage-'));
    tempRoots.push(root);
    const storage = new LocalStorageService(root);

    const stored = await storage.saveFile({
      buffer: Buffer.from('studentCode,finalStatus\nSV001,passed\n', 'utf8'),
      originalName: 'review-results.csv',
      mimeType: 'text/csv',
      directory: 'exports',
    });

    expect(stored.filePath).toMatch(/^exports\/.+review-results\.csv$/);
    await expect(fs.access(path.resolve(root, stored.filePath))).resolves.toBeUndefined();
  });
});
