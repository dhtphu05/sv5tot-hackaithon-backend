import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../../config/env';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import type { StorageAdapter, UploadObjectParams } from '../storage.types';

export class R2StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor() {
    this.bucketName = env.R2_BUCKET_NAME || '';
    this.client = new S3Client({
      endpoint: env.R2_ENDPOINT,
      region: env.R2_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async uploadObject(params: UploadObjectParams): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: params.key,
      Body: params.buffer,
      ContentType: params.contentType,
      Metadata: params.metadata,
    });
    await this.send(command, 'upload');
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    await this.send(command, 'delete');
  }

  async getSignedReadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    try {
      return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
    } catch (error) {
      throw mapR2Error(error, 'sign-read-url');
    }
  }

  private async send(command: PutObjectCommand | DeleteObjectCommand, action: string): Promise<void> {
    try {
      await this.client.send(command);
    } catch (error) {
      throw mapR2Error(error, action);
    }
  }
}

function mapR2Error(error: unknown, action: string): AppError {
  const name =
    error instanceof Error
      ? error.name
      : typeof error === 'object' && error && 'name' in error
        ? String((error as { name?: unknown }).name)
        : 'R2Error';
  const statusCode = name === 'AccessDenied' ? 403 : name === 'NoSuchBucket' ? 404 : 502;

  return new AppError(statusCode, ErrorCodes.STORAGE_ERROR, `R2 ${action} failed: ${name}`, {
    provider: 'r2',
    action,
    code: name,
  });
}
