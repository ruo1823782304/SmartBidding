import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { Client } from 'minio';
import * as path from 'path';
import { Readable } from 'stream';

export interface StoredObjectRef {
  bucket: string;
  key: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? '127.0.0.1',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
  });

  private readonly defaultBucket = process.env.MINIO_BUCKET ?? 'smartbidding';
  private readonly localRoot = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? './local-storage');

  async uploadBuffer(key: string, buffer: Buffer, meta?: Record<string, string>): Promise<StoredObjectRef> {
    try {
      await this.ensureBucket(this.defaultBucket);
      await this.client.putObject(this.defaultBucket, key, buffer, buffer.length, meta);
      return { bucket: this.defaultBucket, key };
    } catch (error) {
      this.logger.warn(`MinIO unavailable, fallback to local storage: ${this.describeError(error)}`);
      return this.writeLocalBuffer(key, buffer);
    }
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    if (bucket === 'local') {
      return this.readLocalBuffer(key);
    }

    try {
      const stream = await this.client.getObject(bucket, key);
      return this.streamToBuffer(stream);
    } catch (error) {
      const localPath = this.resolveLocalPath(key);
      if (existsSync(localPath)) {
        this.logger.warn(`MinIO read failed, using local fallback: ${this.describeError(error)}`);
        return this.readLocalBuffer(key);
      }
      throw error;
    }
  }

  async deleteObject(bucket: string, key: string) {
    if (bucket === 'local') {
      await this.deleteLocalBuffer(key);
      return;
    }

    try {
      await this.client.removeObject(bucket, key);
    } catch (error) {
      const localPath = this.resolveLocalPath(key);
      if (existsSync(localPath)) {
        this.logger.warn(`MinIO delete failed, deleting local fallback: ${this.describeError(error)}`);
        await this.deleteLocalBuffer(key);
        return;
      }
      this.logger.warn(`Storage delete failed: ${this.describeError(error)}`);
    }
  }

  private async ensureBucket(bucket: string) {
    const exists = await this.client.bucketExists(bucket);
    if (!exists) {
      await this.client.makeBucket(bucket);
    }
  }

  private async writeLocalBuffer(key: string, buffer: Buffer): Promise<StoredObjectRef> {
    const targetPath = this.resolveLocalPath(key);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, buffer);
    return { bucket: 'local', key };
  }

  private async readLocalBuffer(key: string) {
    return readFile(this.resolveLocalPath(key));
  }

  private async deleteLocalBuffer(key: string) {
    await rm(this.resolveLocalPath(key), { force: true }).catch(() => undefined);
  }

  private resolveLocalPath(key: string) {
    return path.join(this.localRoot, key.replace(/[\\/]+/g, path.sep));
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private describeError(error: unknown) {
    return error instanceof Error ? error.message : 'unknown storage error';
  }
}
