import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ParseResultItem, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ProjectService } from '../project/project.service';
import { StorageService } from '../storage/storage.service';
import { DocumentService } from '../document/document.service';
import { QueueService } from '../queue/queue.service';
import { TENDER_PARSE_CATALOG } from '../rag/tender-parse.catalog';

@Injectable()
export class TenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly project: ProjectService,
    private readonly storage: StorageService,
    private readonly documentService: DocumentService,
    private readonly queueService: QueueService,
  ) {}

  async upload(projectId: string, file: Express.Multer.File) {
    if (!projectId) {
      throw new BadRequestException('projectId is required.');
    }
    if (!file) {
      throw new BadRequestException('Tender file is required.');
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const objectKey = `tender/${projectId}/${Date.now()}_${this.safeFileName(file.originalname)}`;
    const storedObject = await this.storage.uploadBuffer(objectKey, file.buffer, {
      'Content-Type': file.mimetype || 'application/octet-stream',
      'Original-File-Name': encodeURIComponent(file.originalname),
    });

    const created = await this.documentService.createTenderUpload({
      projectId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      storageBucket: storedObject.bucket,
      storageKey: storedObject.key,
      fileBuffer: file.buffer,
    });

    return {
      success: true,
      fileId: created.tenderFileId,
      documentId: created.documentId,
      documentVersionId: created.documentVersionId,
      versionNo: created.versionNo,
      fileName: file.originalname,
      size: String(file.size),
    };
  }

  async parse(projectId: string, fileId?: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const source = await this.documentService.resolveTenderSource(projectId, fileId);
    const parseJob = await this.documentService.createParseJob(projectId, source.documentId, source.documentVersionId);

    await this.queueService.enqueueTenderParse({ parseJobId: parseJob.id });

    return {
      success: true,
      taskId: parseJob.id,
      parseJobId: parseJob.id,
      status: parseJob.status,
      documentId: source.documentId,
      documentVersionId: source.documentVersionId,
    };
  }

  async getParseResult(projectId?: string, taskId?: string) {
    const job = taskId
      ? await this.documentService.getParseJobWithResult(taskId)
      : projectId
        ? await this.documentService.getLatestProjectParseJob(projectId)
        : null;

    if (!projectId && !taskId) {
      throw new BadRequestException('Either projectId or taskId is required.');
    }

    if (!job) {
      return {
        status: 'pending',
        progress: 0,
        result: undefined,
      };
    }

    return {
      status: job.status.toLowerCase(),
      progress: job.progress,
      stage: job.currentStage,
      result: job.parseResult
        ? {
            parseResultId: job.parseResult.id,
            summary: job.parseResult.summary,
            majorItems: this.groupParseItems(job.parseResult.items),
          }
        : undefined,
    };
  }

  async getParseItemTrace(itemId: string) {
    const item = await this.prisma.parseResultItem.findUnique({
      where: { id: itemId },
      include: {
        parseResult: {
          select: {
            id: true,
            projectId: true,
            documentId: true,
            documentVersionId: true,
            summary: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Parse result item not found.');
    }

    const blockIds = this.toStringArray(item.sourceParagraphIds);
    const chunkIds = this.toStringArray(item.sourceChunkIds);

    const [blocks, chunks] = await Promise.all([
      blockIds.length > 0
        ? this.prisma.documentBlock.findMany({
            where: { id: { in: blockIds } },
            include: { page: true },
          })
        : Promise.resolve([]),
      chunkIds.length > 0
        ? this.prisma.documentChunk.findMany({
            where: { id: { in: chunkIds } },
          })
        : Promise.resolve([]),
    ]);

    const orderedBlocks = [...blocks].sort((left, right) => {
      const pageDiff = (left.page?.pageNo ?? 0) - (right.page?.pageNo ?? 0);
      if (pageDiff !== 0) return pageDiff;
      return (left.paragraphNo ?? 0) - (right.paragraphNo ?? 0);
    });

    return {
      item: {
        id: item.id,
        majorCode: item.majorCode,
        minorCode: item.minorCode,
        title: item.title,
        content: item.content,
        sourceQuote: item.sourceQuote,
        parseResultId: item.parseResultId,
        parseSummary: item.parseResult.summary,
      },
      trace: orderedBlocks.map((block) => ({
        blockId: block.id,
        pageNo: block.page?.pageNo ?? null,
        sectionPath: block.sectionPath,
        paragraphNo: block.paragraphNo,
        bbox: block.bbox,
        charStart: block.charStart,
        charEnd: block.charEnd,
        quote: block.text,
        documentVersionId: block.documentVersionId,
      })),
      chunks: chunks.map((chunk) => ({
        chunkId: chunk.id,
        sectionPath: chunk.sectionPath,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        sourceBlockIds: chunk.sourceBlockIds,
        text: chunk.text,
      })),
      parseResult: item.parseResult,
    };
  }

  async generateOutline(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const latestResult = await this.documentService.getLatestProjectParseJob(projectId);
    const outline = await this.ai.generateOutline(
      projectId,
      latestResult?.parseResult?.summary ?? project.tenderOutline ?? undefined,
    );

    const techOutlineSections = outline.filter(
      (group) =>
        group.group?.includes('\u6280\u672f') ||
        group.group?.toLowerCase().includes('tech') ||
        group.group === '\u6280\u672f\u6807',
    );
    const bizOutlineSections = outline.filter(
      (group) =>
        group.group?.includes('\u5546\u52a1') ||
        group.group?.toLowerCase().includes('business') ||
        group.group === '\u5546\u52a1\u6807',
    );

    if (techOutlineSections.length === 0) {
      techOutlineSections.push({
        group: '\u6280\u672f\u6807',
        sections: [{ name: '\u603b\u4f53\u6280\u672f\u65b9\u6848', detail: '' }],
      });
    }
    if (bizOutlineSections.length === 0) {
      bizOutlineSections.push({
        group: '\u5546\u52a1\u6807',
        sections: [{ name: '\u8d44\u4fe1\u8bc1\u660e', detail: '' }],
      });
    }

    await this.project.updateOutline(projectId, {
      techOutlineSections,
      bizOutlineSections,
    });

    return { success: true, outline };
  }

  private safeFileName(fileName: string) {
    return fileName.replace(/[^\w.-]+/g, '_');
  }

  private groupParseItems(items: ParseResultItem[]) {
    return TENDER_PARSE_CATALOG.map((catalog) => ({
      majorCode: catalog.majorCode,
      majorName: catalog.title,
      items: items
        .filter((item) => item.majorCode === catalog.majorCode)
        .map((item) => ({
          id: item.id,
          minorCode: item.minorCode,
          title: item.title,
          content: item.content,
          confidence: item.confidence,
          priority: item.priority,
          isRequired: item.isRequired,
          riskLevel: item.riskLevel,
          sourceParagraphIds: item.sourceParagraphIds,
          sourceChunkIds: item.sourceChunkIds,
          sourceQuote: item.sourceQuote,
          normalizedValue: item.normalizedValue,
        })),
    }));
  }

  private toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
  }
}
