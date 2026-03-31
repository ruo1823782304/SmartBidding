import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DocumentBizCategory, DocumentType, MajorParseCode, ParseJobStage, RiskLevel } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { Prisma } from '@prisma/client';
import { DocumentService } from '../../document/document.service';
import { QueueService, TENDER_PARSE_QUEUE, TenderParseQueuePayload } from '../../queue/queue.service';
import { DoclingAdapterService } from '../../rag/docling-adapter.service';
import { RagService } from '../../rag/rag.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class TenderParseWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenderParseWorker.name);
  private worker?: Worker<TenderParseQueuePayload>;

  constructor(
    private readonly queueService: QueueService,
    private readonly documentService: DocumentService,
    private readonly storageService: StorageService,
    private readonly doclingAdapter: DoclingAdapterService,
    private readonly ragService: RagService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<TenderParseQueuePayload>(
      TENDER_PARSE_QUEUE,
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

  private async handle(job: Job<TenderParseQueuePayload>) {
    await this.documentService.markParseJobRunning(job.data.parseJobId, ParseJobStage.DOCLING, 10);

    try {
      const parseJob = await this.documentService.getParseJobContext(job.data.parseJobId);
      const buffer = await this.storageService.getObjectBuffer(
        parseJob.documentVersion.storageBucket,
        parseJob.documentVersion.storageKey,
      );

      await this.documentService.updateParseJobProgress(parseJob.id, ParseJobStage.BLOCK_EXTRACT, 30);
      const structured = await this.doclingAdapter.extractStructuredDocument(parseJob.documentVersion.fileName, buffer);

      const temporaryBlocks = structured.blocks.map((block, index) => ({
        id: `temp-${index + 1}`,
        pageNo: block.pageNo,
        blockType: block.blockType,
        sectionPath: block.sectionPath,
        paragraphNo: block.paragraphNo,
        text: block.text,
      }));
      const chunkDrafts = this.ragService.buildChunks(temporaryBlocks);

      await this.documentService.updateParseJobProgress(parseJob.id, ParseJobStage.CHUNK_INDEX, 60);
      const persisted = await this.documentService.replaceStructuredContent({
        documentId: parseJob.documentId,
        documentVersionId: parseJob.documentVersionId,
        versionNo: parseJob.documentVersion.versionNo,
        documentType: DocumentType.TENDER,
        bizCategory: DocumentBizCategory.TENDER_SOURCE,
        structured,
        chunks: chunkDrafts,
      });

      await this.documentService.updateParseJobProgress(parseJob.id, ParseJobStage.LLM_EXTRACT, 85);
      const parseResultDraft = this.ragService.buildParseResult(persisted.chunks);

      await this.documentService.replaceParseResult({
        parseJobId: parseJob.id,
        projectId: parseJob.projectId ?? undefined,
        documentId: parseJob.documentId,
        documentVersionId: parseJob.documentVersionId,
        summary: parseResultDraft.summary,
        items: parseResultDraft.items.map((item) => ({
          majorCode: item.majorCode as MajorParseCode,
          minorCode: item.minorCode,
          title: item.title,
          content: item.content,
          normalizedValue: item.normalizedValue as Prisma.InputJsonValue | undefined,
          confidence: item.confidence,
          priority: item.priority,
          isRequired: item.isRequired,
          riskLevel: item.riskLevel as RiskLevel,
          sourceParagraphIds: item.sourceParagraphIds,
          sourceChunkIds: item.sourceChunkIds,
          sourceQuote: item.sourceQuote,
        })),
      });

      await this.documentService.markParseJobSucceeded(parseJob.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tender parse worker failed';
      this.logger.error(message, error instanceof Error ? error.stack : undefined);
      await this.documentService.markParseJobFailed(job.data.parseJobId, message);
      throw error;
    }
  }
}
