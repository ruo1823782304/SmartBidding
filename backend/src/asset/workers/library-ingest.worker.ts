import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { LibraryIngestService } from '../library-ingest.service';
import { AssetIngestQueuePayload, ASSET_INGEST_QUEUE, QueueService } from '../../queue/queue.service';

@Injectable()
export class LibraryIngestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LibraryIngestWorker.name);
  private worker?: Worker<AssetIngestQueuePayload>;

  constructor(
    private readonly queueService: QueueService,
    private readonly libraryIngestService: LibraryIngestService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<AssetIngestQueuePayload>(
      ASSET_INGEST_QUEUE,
      async (job) => this.handle(job),
      {
        connection: this.queueService.getConnection(),
        concurrency: 1,
      },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<AssetIngestQueuePayload>) {
    try {
      await this.libraryIngestService.processJob(job.data.ingestJobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Library ingest worker failed';
      this.logger.error(message, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
