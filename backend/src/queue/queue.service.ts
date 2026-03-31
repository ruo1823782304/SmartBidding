import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import IORedis from 'ioredis';

export const TENDER_PARSE_QUEUE = 'tender-parse';

export interface TenderParseQueuePayload {
  parseJobId: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
  });

  private readonly tenderParseQueue = new Queue<TenderParseQueuePayload>(TENDER_PARSE_QUEUE, {
    connection: this.connection,
  });

  async enqueueTenderParse(payload: TenderParseQueuePayload, options?: JobsOptions) {
    return this.tenderParseQueue.add('parse', payload, {
      attempts: 2,
      removeOnComplete: 50,
      removeOnFail: 100,
      ...options,
    });
  }

  getConnection() {
    return this.connection;
  }

  async onModuleDestroy() {
    await this.tenderParseQueue.close();
    await this.connection.quit();
  }
}
