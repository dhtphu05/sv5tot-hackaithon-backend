import { env } from '../../config/env';
import type { StorageAdapter, UploadObjectParams } from './storage.types';
import { R2StorageAdapter } from './adapters/r2-storage.adapter';
import { LocalStorageAdapter } from './adapters/local-storage.adapter';

export class StorageService implements StorageAdapter {
  private readonly defaultAdapter: StorageAdapter;
  private readonly r2Adapter: R2StorageAdapter;
  private readonly localAdapter: LocalStorageAdapter;

  constructor() {
    this.r2Adapter = new R2StorageAdapter();
    this.localAdapter = new LocalStorageAdapter();

    if (env.STORAGE_DRIVER === 'r2') {
      this.defaultAdapter = this.r2Adapter;
    } else {
      this.defaultAdapter = this.localAdapter;
    }
  }

  async uploadObject(params: UploadObjectParams): Promise<void> {
    return this.defaultAdapter.uploadObject(params);
  }

  /**
   * Delete an object.
   * If storageType is provided, deletes from that specific storage adapter.
   * Otherwise, deletes from the default active adapter.
   */
  async deleteObject(key: string, storageType?: 'r2' | 'local' | 's3' | string): Promise<void> {
    if (storageType === 'r2') {
      await this.r2Adapter.deleteObject(key);
    } else if (storageType === 'local') {
      await this.localAdapter.deleteObject(key);
    } else {
      await this.defaultAdapter.deleteObject(key);
    }
  }

  /**
   * Generate a signed read URL.
   * If storageType is provided, uses that specific storage adapter.
   * Otherwise, uses the default active adapter.
   */
  async getSignedReadUrl(
    key: string,
    expiresInSeconds = 300,
    storageType?: 'r2' | 'local' | 's3' | string,
  ): Promise<string> {
    if (storageType === 'r2') {
      return this.r2Adapter.getSignedReadUrl(key, expiresInSeconds);
    } else if (storageType === 'local') {
      return this.localAdapter.getSignedReadUrl(key, expiresInSeconds);
    } else {
      return this.defaultAdapter.getSignedReadUrl(key, expiresInSeconds);
    }
  }
}
