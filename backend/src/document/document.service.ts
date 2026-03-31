import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BlockType,
  ChunkType,
  DocumentBizCategory,
  DocumentStatus,
  DocumentType,
  ParseJobStage,
  ParseJobStatus,
  ParseJobType,
  Prisma,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChunkDraft, PersistedBlockRef, PersistedChunkRef, StructuredDocument } from '../rag/rag.types';

@Injectable()
export class DocumentService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenderUpload(params: {
    projectId: string;
    fileName: string;
    mimeType?: string;
    fileSize?: number;
    storageBucket: string;
    storageKey: string;
    uploadedBy?: string;
    fileBuffer: Buffer;
  }) {
    const existingDocument = await this.prisma.document.findFirst({
      where: {
        projectId: params.projectId,
        documentType: DocumentType.TENDER,
      },
      orderBy: { createdAt: 'asc' },
    });

    const document =
      existingDocument ??
      (await this.prisma.document.create({
        data: {
          projectId: params.projectId,
          documentType: DocumentType.TENDER,
          bizCategory: DocumentBizCategory.TENDER_SOURCE,
          title: params.fileName,
          mimeType: params.mimeType,
          fileExt: this.getExt(params.fileName),
          createdBy: params.uploadedBy,
        },
      }));

    const latestVersion = await this.prisma.documentVersion.findFirst({
      where: { documentId: document.id },
      orderBy: { versionNo: 'desc' },
    });

    const version = await this.prisma.documentVersion.create({
      data: {
        documentId: document.id,
        versionNo: (latestVersion?.versionNo ?? 0) + 1,
        storageBucket: params.storageBucket,
        storageKey: params.storageKey,
        fileName: params.fileName,
        fileSize: params.fileSize,
        contentHash: createHash('sha256').update(params.fileBuffer).digest('hex'),
        createdBy: params.uploadedBy,
      },
    });

    await this.prisma.document.update({
      where: { id: document.id },
      data: {
        title: params.fileName,
        mimeType: params.mimeType,
        fileExt: this.getExt(params.fileName),
        currentVersionId: version.id,
        status: DocumentStatus.UPLOADED,
      },
    });

    const tenderFile = await this.prisma.tenderFile.create({
      data: {
        projectId: params.projectId,
        fileKey: params.storageKey,
        fileName: params.fileName,
        size: params.fileSize,
        documentId: document.id,
        documentVersionId: version.id,
      },
    });

    return {
      documentId: document.id,
      documentVersionId: version.id,
      tenderFileId: tenderFile.id,
      versionNo: version.versionNo,
    };
  }

  async resolveTenderSource(projectId: string, fileId?: string) {
    const tenderFile = fileId
      ? await this.prisma.tenderFile.findFirst({
          where: { id: fileId, projectId },
        })
      : await this.prisma.tenderFile.findFirst({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
        });

    if (!tenderFile?.documentId || !tenderFile.documentVersionId) {
      throw new NotFoundException('未找到可解析的招标文件版本。');
    }

    const version = await this.prisma.documentVersion.findUnique({
      where: { id: tenderFile.documentVersionId },
    });

    if (!version) {
      throw new NotFoundException('招标文件版本不存在。');
    }

    return {
      tenderFile,
      documentId: tenderFile.documentId,
      documentVersionId: tenderFile.documentVersionId,
      storageBucket: version.storageBucket,
      storageKey: version.storageKey,
      versionNo: version.versionNo,
      fileName: version.fileName,
    };
  }

  async createParseJob(projectId: string, documentId: string, documentVersionId: string) {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.PARSING },
    });

    await this.prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: { parseStatus: ParseJobStatus.PENDING },
    });

    return this.prisma.parseJob.create({
      data: {
        projectId,
        documentId,
        documentVersionId,
        jobType: ParseJobType.TENDER_PARSE,
        status: ParseJobStatus.PENDING,
        progress: 0,
        currentStage: ParseJobStage.UPLOAD,
      },
    });
  }

  async markParseJobRunning(parseJobId: string, stage: ParseJobStage, progress: number) {
    const job = await this.prisma.parseJob.update({
      where: { id: parseJobId },
      data: {
        status: ParseJobStatus.RUNNING,
        currentStage: stage,
        progress,
        startedAt: new Date(),
      },
    });

    await this.prisma.documentVersion.update({
      where: { id: job.documentVersionId },
      data: { parseStatus: ParseJobStatus.RUNNING },
    });

    return job;
  }

  async updateParseJobProgress(parseJobId: string, stage: ParseJobStage, progress: number) {
    return this.prisma.parseJob.update({
      where: { id: parseJobId },
      data: {
        currentStage: stage,
        progress,
      },
    });
  }

  async markParseJobFailed(parseJobId: string, errorMessage: string) {
    const job = await this.prisma.parseJob.update({
      where: { id: parseJobId },
      data: {
        status: ParseJobStatus.FAILED,
        currentStage: ParseJobStage.FINALIZE,
        progress: 100,
        errorMessage,
        finishedAt: new Date(),
      },
    });

    await this.prisma.document.update({
      where: { id: job.documentId },
      data: { status: DocumentStatus.FAILED },
    });

    await this.prisma.documentVersion.update({
      where: { id: job.documentVersionId },
      data: { parseStatus: ParseJobStatus.FAILED },
    });
  }

  async markParseJobSucceeded(parseJobId: string) {
    const job = await this.prisma.parseJob.update({
      where: { id: parseJobId },
      data: {
        status: ParseJobStatus.SUCCEEDED,
        currentStage: ParseJobStage.FINALIZE,
        progress: 100,
        finishedAt: new Date(),
      },
    });

    await this.prisma.document.update({
      where: { id: job.documentId },
      data: { status: DocumentStatus.READY },
    });

    await this.prisma.documentVersion.update({
      where: { id: job.documentVersionId },
      data: { parseStatus: ParseJobStatus.SUCCEEDED },
    });
  }

  async getParseJobContext(parseJobId: string) {
    const parseJob = await this.prisma.parseJob.findUnique({
      where: { id: parseJobId },
      include: {
        documentVersion: true,
        document: true,
      },
    });

    if (!parseJob) {
      throw new NotFoundException('解析任务不存在。');
    }

    return parseJob;
  }

  async getParseJobWithResult(parseJobId: string) {
    return this.prisma.parseJob.findUnique({
      where: { id: parseJobId },
      include: {
        parseResult: {
          include: {
            items: true,
          },
        },
      },
    });
  }

  async getLatestProjectParseJob(projectId: string) {
    return this.prisma.parseJob.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        parseResult: {
          include: {
            items: true,
          },
        },
      },
    });
  }

  async replaceStructuredContent(params: {
    documentId: string;
    documentVersionId: string;
    versionNo: number;
    documentType: DocumentType;
    bizCategory: DocumentBizCategory;
    structured: StructuredDocument;
    chunks: ChunkDraft[];
  }): Promise<{ blocks: PersistedBlockRef[]; chunks: PersistedChunkRef[] }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.generationCitation.deleteMany({
        where: {
          chunk: {
            is: {
              documentVersionId: params.documentVersionId,
            },
          },
        },
      });
      await tx.retrievalLogHit.deleteMany({
        where: {
          chunk: {
            is: {
              documentVersionId: params.documentVersionId,
            },
          },
        },
      });
      await tx.sectionEvidence.deleteMany({
        where: {
          documentVersionId: params.documentVersionId,
        },
      });
      await tx.documentChunk.deleteMany({
        where: { documentVersionId: params.documentVersionId },
      });
      await tx.documentBlock.deleteMany({
        where: { documentVersionId: params.documentVersionId },
      });
      await tx.documentPage.deleteMany({
        where: { documentVersionId: params.documentVersionId },
      });

      const pageIdMap = new Map<number, string>();
      for (const page of params.structured.pages) {
        const createdPage = await tx.documentPage.create({
          data: {
            documentVersionId: params.documentVersionId,
            pageNo: page.pageNo,
            width: page.width,
            height: page.height,
            rotation: page.rotation,
            imageKey: page.imageKey,
          },
        });
        pageIdMap.set(page.pageNo, createdPage.id);
      }

      const persistedBlocks: PersistedBlockRef[] = [];
      for (const block of params.structured.blocks) {
        const createdBlock = await tx.documentBlock.create({
          data: {
            documentVersionId: params.documentVersionId,
            pageId: pageIdMap.get(block.pageNo),
            blockType: block.blockType as BlockType,
            sectionPath: block.sectionPath,
            headingLevel: block.headingLevel,
            paragraphNo: block.paragraphNo,
            text: block.text,
            textHash: createHash('sha1').update(block.text).digest('hex'),
            tokens: this.estimateTokens(block.text),
            bbox: this.toJsonValue(block.bbox),
            metadata: this.toJsonValue(block.metadata),
          },
        });
        persistedBlocks.push({
          id: createdBlock.id,
          pageNo: block.pageNo,
          blockType: block.blockType,
          sectionPath: block.sectionPath,
          paragraphNo: block.paragraphNo,
          text: block.text,
        });
      }

      const blockIdMap = new Map(
        persistedBlocks.map((block, index) => [`temp-${index + 1}`, block.id]),
      );

      const persistedChunks: PersistedChunkRef[] = [];
      for (const chunk of params.chunks) {
        const createdChunk = await tx.documentChunk.create({
          data: {
            documentVersionId: params.documentVersionId,
            documentId: params.documentId,
            chunkType: chunk.chunkType as ChunkType,
            sourceBlockIds: chunk.sourceBlockIds.map((id) => blockIdMap.get(id) ?? id),
            sectionPath: chunk.sectionPath,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            text: chunk.text,
            textForEmbedding: chunk.textForEmbedding,
            keywords: chunk.keywords,
            importanceScore: chunk.importanceScore,
            documentType: params.documentType,
            bizCategory: params.bizCategory,
            versionNo: params.versionNo,
          },
        });

        persistedChunks.push({
          ...chunk,
          id: createdChunk.id,
          sourceBlockIds: chunk.sourceBlockIds.map((id) => blockIdMap.get(id) ?? id),
        });
      }

      return {
        blocks: persistedBlocks,
        chunks: persistedChunks,
      };
    });
  }

  async replaceParseResult(params: {
    parseJobId: string;
    projectId?: string;
    documentId: string;
    documentVersionId: string;
    summary: string;
    items: Array<{
      majorCode: Prisma.ParseResultItemUncheckedCreateInput['majorCode'];
      minorCode: string;
      title: string;
      content: string;
      normalizedValue?: Prisma.InputJsonValue;
      confidence?: number;
      priority?: string;
      isRequired: boolean;
      riskLevel: Prisma.ParseResultItemUncheckedCreateInput['riskLevel'];
      sourceParagraphIds: Prisma.InputJsonValue;
      sourceChunkIds: Prisma.InputJsonValue;
      sourceQuote?: string;
    }>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.parseResult.findUnique({
        where: { parseJobId: params.parseJobId },
      });

      if (existing) {
        await tx.parseResultItem.deleteMany({
          where: { parseResultId: existing.id },
        });
      }

      const parseResult =
        existing ??
        (await tx.parseResult.create({
          data: {
            parseJobId: params.parseJobId,
            projectId: params.projectId,
            documentId: params.documentId,
            documentVersionId: params.documentVersionId,
            schemaVersion: 'tender-parse-v1',
            promptVersion: 'pipeline-v1',
            modelProvider: 'rule-based',
            modelName: 'minimal-pipeline',
            status: 'succeeded',
            summary: params.summary,
          },
        }));

      if (existing) {
        await tx.parseResult.update({
          where: { id: existing.id },
          data: {
            summary: params.summary,
            status: 'succeeded',
          },
        });
      }

      if (params.items.length > 0) {
        await tx.parseResultItem.createMany({
          data: params.items.map((item) => ({
            parseResultId: parseResult.id,
            ...item,
          })),
        });
      }

      return parseResult;
    });
  }

  private estimateTokens(text: string) {
    return Math.max(1, Math.ceil(text.length / 2));
  }

  private getExt(fileName: string) {
    const match = /\.([^.]+)$/.exec(fileName);
    return match ? `.${match[1].toLowerCase()}` : undefined;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return value as Prisma.InputJsonValue;
  }
}
