import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../../config/env';
import type { StorageAdapter, UploadObjectParams } from '../storage.types';

export class R2StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor() {
    this.bucketName = env.R2_BUCKET_NAME || '';
    this.client = new S3Client({
      endpoint: env.R2_ENDPOINT,
      region: 'auto',
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
    await this.client.send(command);
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    await this.client.send(command);
  }

  async getSignedReadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
