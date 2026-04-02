import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentBizCategory, DocumentStatus, DocumentType, Prisma } from '@prisma/client';
import { HeadingLevel, Packer, Paragraph, TextRun, Document as WordDocument } from 'docx';
import { AiService } from '../ai/ai.service';
import { DocumentService } from '../document/document.service';
import { PrismaService } from '../prisma/prisma.service';
import { DoclingAdapterService } from '../rag/docling-adapter.service';
import { PersistedBlockRef, PersistedChunkRef } from '../rag/rag.types';
import { RagService } from '../rag/rag.service';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { AssetService } from './asset.service';
import { DocxBodyEntry, extractDocxBodyEntries, extractDocxEntryRangeBuffer, extractDocxSubsetBuffer } from './docx-preserve.util';
import { buildSafeFileName, normalizePossiblyMojibakeText, normalizeUploadedFileName } from './file-name.util';

type IngestStatus = 'pending' | 'running' | 'succeeded' | 'partial_review' | 'failed';
type IngestItemStatus = 'completed' | 'pending_review';

type IngestDraftItem = {
  status: IngestItemStatus;
  targetCategory?: string;
  targetSubtype?: string;
  suggestedCategory?: string;
  suggestedSubtype?: string;
  title?: string;
  content: string;
  sourceQuote: string;
  sourceOutline: string;
  sourceBlockIds: string[];
  sourceChunkIds: string[];
  metadata?: Record<string, unknown>;
};

type ChunkGroup = {
  key: string;
  label: string;
  chunks: PersistedChunkRef[];
};

type DocxEntryRange = {
  startIndex: number;
  endIndex: number;
};

const QUALIFICATION_DEFINITIONS = [
  { subtype: 'company_basic_form', label: '公司基本情况表', keywords: ['公司基本情况表', '基本情况表', '企业基本情况', '公司基本情况'] },
  { subtype: 'company_profile', label: '公司简介', keywords: ['公司简介', '企业简介'] },
  { subtype: 'qualification_list', label: '公司资质清单', keywords: ['资质清单', '资质证书', '公司资质', '认证证书', '荣誉证书', '行业资质'] },
  { subtype: 'customer_share', label: '客户占有率', keywords: ['客户占有率', '市场占有率', '客户覆盖', '客户分布', '客户情况'] },
  { subtype: 'regulator_case', label: '与监管合作案例', keywords: ['监管合作案例', '监管案例', '与监管合作', '监管报送案例', '监管机构的合作', '监管机构合作'] },
  { subtype: 'org_structure', label: '公司组织架构', keywords: ['组织架构', '组织机构', '公司组织架构', '组织结构', '组织架构介绍', '组织机构图'] },
] as const;

const RESUME_ROLE_KEYWORDS = [
  '项目经理',
  '项目总监',
  '项目成员',
  '测试工程师',
  '实施工程师',
  '业务分析师',
  '产品经理',
  '顾问',
  '质量管理工程师',
  '质量管理经理',
] as const;

@Injectable()
export class LibraryIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly documentService: DocumentService,
    private readonly doclingAdapter: DoclingAdapterService,
    private readonly ragService: RagService,
    private readonly queueService: QueueService,
    private readonly assetService: AssetService,
    private readonly ai: AiService,
  ) {}

  async createJob(file: Express.Multer.File | undefined, username: string) {
    if (!file) {
      throw new BadRequestException('历史标书文件不能为空。');
    }

    const normalizedFileName = normalizeUploadedFileName(file.originalname);
    const ext = this.safeExt(normalizedFileName);
    if (ext !== 'docx') {
      throw new BadRequestException('企业库入库当前仅支持 DOCX。要保证下载件与原标书的格式、表格、字体完全一致，必须上传 DOCX 源文件。');
    }

    const sourceTitle = await this.assetService.ensureUniqueTitle(
      'ingest',
      'ingest_source',
      this.baseName(normalizedFileName),
    );
    const archiveTitle = await this.assetService.ensureUniqueTitle(
      'archive',
      'archive_original',
      this.baseName(normalizedFileName),
    );

    const objectKey = `assets/ingest/${Date.now()}_${this.safeFileName(normalizedFileName)}`;
    const storedObject = await this.storage.uploadBuffer(objectKey, file.buffer, {
      'Content-Type': file.mimetype || 'application/octet-stream',
      'Original-File-Name': encodeURIComponent(normalizedFileName),
    });

    const job = await this.prisma.libraryIngestJob.create({
      data: {
        sourceFileName: normalizedFileName,
        status: 'pending',
        progress: 0,
        createdBy: username,
      },
    });

    const [sourceAsset, archiveAsset] = await Promise.all([
      this.prisma.asset.create({
        data: {
          category: 'ingest',
          subtype: 'ingest_source',
          title: sourceTitle,
          sourceMode: 'ingest_original',
          metadata: {
            originalFileName: normalizedFileName,
            mimeType: file.mimetype,
            fileSize: file.size,
          },
          ingestJobId: job.id,
          uploadedBy: username,
        },
      }),
      this.prisma.asset.create({
        data: {
          category: 'archive',
          subtype: 'archive_original',
          title: archiveTitle,
          sourceMode: 'ingest_archive',
          metadata: {
            originalFileName: normalizedFileName,
            mimeType: file.mimetype,
            fileSize: file.size,
          },
          ingestJobId: job.id,
          uploadedBy: username,
        },
      }),
    ]);

    await Promise.all([
      this.documentService.createAssetDocument({
        assetId: sourceAsset.id,
        title: sourceAsset.title,
        fileName: normalizedFileName,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageBucket: storedObject.bucket,
        storageKey: storedObject.key,
        uploadedBy: username,
        fileBuffer: file.buffer,
        bizCategory: DocumentBizCategory.OTHER,
        status: DocumentStatus.READY,
      }),
      this.documentService.createAssetDocument({
        assetId: archiveAsset.id,
        title: archiveAsset.title,
        fileName: normalizedFileName,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageBucket: storedObject.bucket,
        storageKey: storedObject.key,
        uploadedBy: username,
        fileBuffer: file.buffer,
        bizCategory: DocumentBizCategory.OTHER,
        status: DocumentStatus.READY,
      }),
    ]);

    await this.prisma.libraryIngestJob.update({
      where: { id: job.id },
      data: {
        sourceAssetId: sourceAsset.id,
        archiveAssetId: archiveAsset.id,
        archiveMirrored: true,
      },
    });

    await this.queueService.enqueueAssetIngest({ ingestJobId: job.id });
    return this.getJob(job.id);
  }

  async listJobs() {
    const jobs = await this.prisma.libraryIngestJob.findMany({
      where: {
        status: {
          not: 'completed',
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      list: jobs.map((job) => this.toJobSummary(job)),
    };
  }

  async getJob(id: string) {
    const job = await this.prisma.libraryIngestJob.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            asset: {
              include: {
                documents: {
                  take: 1,
                  orderBy: { createdAt: 'desc' },
                  include: { currentVersion: true },
                },
              },
            },
          },
        },
        sourceAsset: {
          include: {
            documents: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: { currentVersion: true },
            },
          },
        },
        archiveAsset: {
          include: {
            documents: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: { currentVersion: true },
            },
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('标书入库任务不存在。');
    }

    return {
      job: this.toJobSummary(job),
      items: job.items.map((item) => this.toJobItem(item)),
      sourceAsset: job.sourceAsset ? this.toJobAsset(job.sourceAsset) : undefined,
      archiveAsset: job.archiveAsset ? this.toJobAsset(job.archiveAsset) : undefined,
    };
  }

  async deleteJob(id: string) {
    const job = await this.prisma.libraryIngestJob.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            id: true,
            assetId: true,
          },
        },
        sourceAsset: {
          select: { id: true },
        },
        archiveAsset: {
          select: { id: true },
        },
        assets: {
          select: { id: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException('标书入库任务不存在。');
    }

    const assetIds = Array.from(
      new Set(
        [
          job.sourceAsset?.id,
          job.archiveAsset?.id,
          ...job.items.map((item) => item.assetId),
          ...job.assets.map((asset) => asset.id),
        ].filter((value): value is string => Boolean(value)),
      ),
    );

    for (const assetId of assetIds) {
      await this.assetService.delete(assetId);
    }

    await this.prisma.libraryIngestItem.deleteMany({
      where: { jobId: job.id },
    });

    await this.prisma.libraryIngestJob.delete({
      where: { id: job.id },
    });

    return { success: true };
  }

  async finalizeJob(id: string) {
    const job = await this.prisma.libraryIngestJob.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        unresolvedCount: true,
      },
    });

    if (!job) {
      throw new NotFoundException('标书入库任务不存在。');
    }

    if (job.status === 'pending' || job.status === 'running') {
      throw new BadRequestException('当前标书仍在处理中，暂时不能确认完成。');
    }

    if (job.status === 'failed') {
      throw new BadRequestException('当前标书处理失败，不能直接确认完成，请先处理失败原因。');
    }

    if (job.unresolvedCount > 0) {
      throw new BadRequestException('还有待确认条目，请先处理后再确认本标书已完成入库。');
    }

    await this.prisma.libraryIngestJob.update({
      where: { id },
      data: {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
      },
    });

    return { success: true };
  }

  async deleteItem(itemId: string) {
    const item = await this.prisma.libraryIngestItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        jobId: true,
        assetId: true,
      },
    });

    if (!item) {
      throw new NotFoundException('入库条目不存在。');
    }

    if (item.assetId) {
      await this.assetService.delete(item.assetId);
    } else {
      await this.prisma.libraryIngestItem.delete({
        where: { id: item.id },
      });
      await this.refreshJobSummary(item.jobId);
    }

    return this.getJob(item.jobId);
  }

  async confirmItem(
    itemId: string,
    input: { targetCategory?: string; targetSubtype?: string; title?: string },
    username: string,
  ) {
    const item = await this.prisma.libraryIngestItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundException('待确认入库项不存在。');
    }

    if (item.status !== 'pending_review') {
      throw new BadRequestException('该条目无需再次确认入库。');
    }

    const targetCategory = input.targetCategory?.trim() || item.suggestedCategory || '';
    const targetSubtype = input.targetSubtype?.trim() || item.suggestedSubtype || '';
    const requestedTitle = input.title?.trim() || item.suggestedTitle || '';

    if (!targetCategory || !targetSubtype || !requestedTitle) {
      throw new BadRequestException('确认入库时必须提供目标分类、目标子类和标题。');
    }

    const content = item.content?.trim();
    if (!content) {
      throw new BadRequestException('当前条目缺少可入库内容。');
    }

    const sourceJob = await this.prisma.libraryIngestJob.findUnique({
      where: { id: item.jobId },
      include: {
        sourceAsset: {
          include: {
            documents: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: { currentVersion: true },
            },
          },
        },
      },
    });
    const sourceDocumentVersionId = sourceJob?.sourceAsset?.documents?.[0]?.currentVersion?.id;

    const finalTitle = await this.assetService.ensureUniqueTitle(targetCategory, targetSubtype, requestedTitle);
    const assetId = await this.createGeneratedAsset({
      jobId: item.jobId,
      category: targetCategory,
      subtype: targetSubtype,
      title: finalTitle,
      content,
      uploadedBy: username,
      sourceDocumentVersionId,
      sourceDocxRange: this.extractDocxRangeFromMetadata(this.toRecord(item.metadata)),
      sourceBlockIds: this.toStringArray(item.sourceBlockIds),
      sourceOutline: item.sourceOutline ?? undefined,
      metadata: {
        confirmedFromItemId: item.id,
        confirmedBy: username,
      },
    });

    await this.prisma.libraryIngestItem.update({
      where: { id: item.id },
      data: {
        status: 'completed',
        targetCategory,
        targetSubtype,
        finalTitle,
        assetId,
        metadata: {
          ...(this.toRecord(item.metadata) ?? {}),
          confirmedBy: username,
        },
      },
    });

    await this.refreshJobSummary(item.jobId);
    return this.getJob(item.jobId);
  }

  async processJob(ingestJobId: string) {
    const job = await this.prisma.libraryIngestJob.findUnique({
      where: { id: ingestJobId },
      include: {
        sourceAsset: {
          include: {
            documents: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: { currentVersion: true },
            },
          },
        },
      },
    });

    if (!job?.sourceAsset?.documents?.[0]?.currentVersion) {
      throw new NotFoundException('入库源文件不存在。');
    }

    await this.prisma.libraryIngestJob.update({
      where: { id: ingestJobId },
      data: {
        status: 'running',
        progress: 5,
        errorMessage: null,
      },
    });

    try {
      const sourceDocument = job.sourceAsset.documents[0];
      const currentVersion = sourceDocument.currentVersion!;
      const buffer = await this.storage.getObjectBuffer(currentVersion.storageBucket, currentVersion.storageKey);
      const docxEntries =
        this.safeExt(currentVersion.fileName) === 'docx'
          ? await extractDocxBodyEntries(buffer)
          : [];

      const structured = await this.doclingAdapter.extractStructuredDocument(currentVersion.fileName, buffer);
      const temporaryBlocks = structured.blocks.map((block, index) => ({
        id: `temp-${index + 1}`,
        pageNo: block.pageNo,
        blockType: block.blockType,
        sectionPath: block.sectionPath,
        paragraphNo: block.paragraphNo,
        text: block.text,
      }));
      const chunkDrafts = this.ragService.buildChunks(temporaryBlocks);

      await this.prisma.libraryIngestJob.update({
        where: { id: ingestJobId },
        data: {
          progress: 30,
        },
      });

      const persisted = await this.documentService.replaceStructuredContent({
        documentId: sourceDocument.id,
        documentVersionId: currentVersion.id,
        versionNo: currentVersion.versionNo,
        documentType: DocumentType.ASSET,
        bizCategory: DocumentBizCategory.OTHER,
        structured,
        chunks: chunkDrafts,
      });

      const staleGeneratedAssets = await this.prisma.asset.findMany({
        where: {
          ingestJobId,
          sourceMode: 'ingest_generated',
        },
        select: { id: true },
      });
      for (const asset of staleGeneratedAssets) {
        await this.assetService.delete(asset.id);
      }

      await this.prisma.libraryIngestItem.deleteMany({
        where: { jobId: ingestJobId },
      });

      const drafts = await this.buildIngestDrafts(
        this.baseName(job.sourceFileName),
        persisted.blocks,
        persisted.chunks,
        docxEntries,
      );

      await this.prisma.libraryIngestJob.update({
        where: { id: ingestJobId },
        data: {
          progress: 60,
        },
      });

      for (let index = 0; index < drafts.length; index += 1) {
        const draft = drafts[index];
        let finalTitle: string | null = null;
        let assetId: string | null = null;

        if (draft.status === 'completed' && draft.targetCategory && draft.targetSubtype && draft.title) {
          finalTitle = await this.assetService.ensureUniqueTitle(
            draft.targetCategory,
            draft.targetSubtype,
            draft.title,
          );
          assetId = await this.createGeneratedAsset({
            jobId: ingestJobId,
            category: draft.targetCategory,
            subtype: draft.targetSubtype,
            title: finalTitle,
            content: draft.content,
            uploadedBy: job.createdBy ?? 'system',
            sourceDocumentVersionId: currentVersion.id,
            sourceDocxRange: this.extractDocxRangeFromMetadata(draft.metadata),
            sourceBlockIds: draft.sourceBlockIds,
            sourceOutline: draft.sourceOutline,
            metadata: {
              autoGenerated: true,
            },
          });
        }

        await this.prisma.libraryIngestItem.create({
          data: {
            jobId: ingestJobId,
            status: draft.status,
            targetCategory: draft.targetCategory,
            targetSubtype: draft.targetSubtype,
            suggestedCategory: draft.suggestedCategory ?? draft.targetCategory,
            suggestedSubtype: draft.suggestedSubtype ?? draft.targetSubtype,
            suggestedTitle: draft.title,
            finalTitle,
            sourceQuote: draft.sourceQuote,
            sourceOutline: draft.sourceOutline,
            content: draft.content,
            sourceBlockIds: draft.sourceBlockIds,
            sourceChunkIds: draft.sourceChunkIds,
            assetId,
            metadata: draft.metadata as Prisma.InputJsonValue | undefined,
          },
        });

        const progress = 60 + Math.round(((index + 1) / Math.max(drafts.length, 1)) * 35);
        await this.prisma.libraryIngestJob.update({
          where: { id: ingestJobId },
          data: {
            progress: Math.min(progress, 95),
          },
        });
      }

      await this.refreshJobSummary(ingestJobId, 100);
    } catch (error) {
      const message = error instanceof Error ? error.message : '历史标书入库失败。';
      await this.prisma.libraryIngestJob.update({
        where: { id: ingestJobId },
        data: {
          status: 'failed',
          progress: 100,
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async buildIngestDrafts(
    bidName: string,
    blocks: PersistedBlockRef[],
    chunks: PersistedChunkRef[],
    docxEntries: DocxBodyEntry[] = [],
  ) {
    const drafts: IngestDraftItem[] = [];

    const docxQualificationDrafts = docxEntries.length > 0 ? this.buildDocxQualificationDrafts(bidName, docxEntries) : [];
    const qualificationSubtypes = new Set(
      docxQualificationDrafts
        .map((draft) => draft.targetSubtype)
        .filter((value) => Boolean(value)),
    );
    drafts.push(...docxQualificationDrafts);
    drafts.push(
      ...this.buildQualificationDrafts(bidName, chunks).filter(
        (draft) => !draft.targetSubtype || !qualificationSubtypes.has(draft.targetSubtype),
      ),
    );
    drafts.push(...this.buildSolutionDrafts(bidName, chunks));
    const docxResumeDrafts = docxEntries.length > 0 ? await this.buildDocxResumeDrafts(bidName, docxEntries) : [];
    if (docxResumeDrafts.length > 0) {
      drafts.push(...docxResumeDrafts);
    } else {
      drafts.push(...await this.buildResumeDrafts(bidName, chunks));
    }
    drafts.push(...await this.buildPerformanceDrafts(chunks));
    drafts.push(...await this.buildWinningDrafts(bidName, chunks));

    const deduped = this.dedupeDrafts(drafts);
    if (deduped.length > 0) {
      return deduped;
    }

    const fallbackChunk = chunks[0];
    const fallbackBlockIds = fallbackChunk?.sourceBlockIds ?? blocks.slice(0, 3).map((block) => block.id);
    return [
      {
        status: 'pending_review' as const,
        suggestedCategory: 'qualification',
        suggestedSubtype: 'company_profile',
        title: `${bidName}-待确认内容`,
        content: fallbackChunk?.text ?? blocks.slice(0, 10).map((block) => block.text).join('\n'),
        sourceQuote: this.trimText(fallbackChunk?.text ?? blocks[0]?.text ?? '未识别内容', 220),
        sourceOutline: fallbackChunk?.sectionPath ?? '未识别内容',
        sourceBlockIds: fallbackBlockIds,
        sourceChunkIds: fallbackChunk ? [fallbackChunk.id] : [],
        metadata: {
          reason: 'no_match',
        },
      },
    ];
  }

  private buildQualificationDrafts(bidName: string, chunks: PersistedChunkRef[]) {
    return QUALIFICATION_DEFINITIONS.flatMap((definition) => {
      const matches = this.pickTopChunks(chunks, definition.keywords, 3);
      if (matches.length === 0) {
        return [];
      }

      const content = this.mergeChunkContent(matches);
      if (!content.trim()) {
        return [];
      }

      return [
        {
          status: 'completed' as const,
          targetCategory: 'qualification',
          targetSubtype: definition.subtype,
          title: `${bidName}-${definition.label}`,
          content,
          sourceQuote: this.trimText(content, 220),
          sourceOutline: this.getLastSectionLabel(matches[0]?.sectionPath) || definition.label,
          sourceBlockIds: matches.flatMap((chunk) => chunk.sourceBlockIds),
          sourceChunkIds: matches.map((chunk) => chunk.id),
        },
      ];
    });
  }

  private buildDocxQualificationDrafts(bidName: string, entries: DocxBodyEntry[]) {
    return QUALIFICATION_DEFINITIONS.flatMap((definition) => {
      const headingIndex = this.findDocxHeadingIndex(entries, definition.keywords);
      if (headingIndex < 0) {
        return [];
      }

      const section = this.sliceDocxSection(entries, headingIndex);
      if (!section.content.trim()) {
        return [];
      }

      return [
        {
          status: 'completed' as const,
          targetCategory: 'qualification',
          targetSubtype: definition.subtype,
          title: `${bidName}-${definition.label}`,
          content: section.content,
          sourceQuote: this.trimText(section.content, 220),
          sourceOutline: section.heading,
          sourceBlockIds: [],
          sourceChunkIds: [],
          metadata: {
            extractionMode: 'docx_raw_section',
            docxEntryRange: {
              startIndex: section.startIndex,
              endIndex: section.endIndex,
            },
          },
        },
      ];
    });
  }

  private async buildDocxResumeDrafts(bidName: string, entries: DocxBodyEntry[]) {
    const resumeAnchorIndex = this.findDocxHeadingIndex(entries, ['项目成员简历']);
    if (resumeAnchorIndex < 0) {
      return [];
    }

    let resumeAreaEnd = entries.length - 1;
    for (let index = resumeAnchorIndex + 1; index < entries.length; index += 1) {
      const text = entries[index]?.text?.trim() ?? '';
      if (!text || this.isLikelyDocxTocEntry(text)) {
        continue;
      }
      if (this.isResumeSectionBoundary(text)) {
        resumeAreaEnd = index - 1;
        break;
      }
    }

    const headingIndexes: number[] = [];
    for (let index = resumeAnchorIndex + 1; index <= resumeAreaEnd; index += 1) {
      if (this.isDocxResumeHeading(entries[index]?.text ?? '')) {
        headingIndexes.push(index);
      }
    }

    const results: IngestDraftItem[] = [];
    for (let cursor = 0; cursor < headingIndexes.length; cursor += 1) {
      const headingIndex = headingIndexes[cursor];
      const nextHeadingIndex = headingIndexes[cursor + 1];
      const endIndex = typeof nextHeadingIndex === 'number' ? nextHeadingIndex - 1 : resumeAreaEnd;
      if (endIndex < headingIndex) {
        continue;
      }

      const sectionEntries = entries.slice(headingIndex, endIndex + 1);
      const content = sectionEntries.map((entry) => entry.text.trim()).filter(Boolean).join('\n');
      if (!content.trim()) {
        continue;
      }

      const heading = entries[headingIndex]?.text?.trim() ?? '';
      const headingRole = this.extractResumeHeadingRole(heading);
      const identity = await this.extractResumeIdentity(content, heading, headingRole);
      const titlePosition = headingRole || identity.position;
      const name = identity.name?.trim();

      if (name) {
        results.push({
          status: 'completed',
          targetCategory: 'resume',
          targetSubtype: 'person_resume',
          title: this.buildResumeTitle(name, identity.company, titlePosition, bidName),
          content,
          sourceQuote: this.trimText(content, 220),
          sourceOutline: heading,
          sourceBlockIds: [],
          sourceChunkIds: [],
          metadata: {
            extractionMode: 'docx_raw_resume',
            name,
            company: identity.company,
            position: titlePosition,
            docxEntryRange: {
              startIndex: headingIndex,
              endIndex,
            },
          },
        });
        continue;
      }

      results.push({
        status: 'pending_review',
        suggestedCategory: 'resume',
        suggestedSubtype: 'person_resume',
        title: this.buildResumeTitle(undefined, identity.company, titlePosition, bidName),
        content,
        sourceQuote: this.trimText(content, 220),
        sourceOutline: heading,
        sourceBlockIds: [],
        sourceChunkIds: [],
        metadata: {
          extractionMode: 'docx_raw_resume',
          reason: 'resume_name_missing',
          company: identity.company,
          position: titlePosition,
          bidName,
          docxEntryRange: {
            startIndex: headingIndex,
            endIndex,
          },
        },
      });
    }

    return results;
  }

  private buildSolutionDrafts(bidName: string, chunks: PersistedChunkRef[]) {
    const groups = this.groupCandidateChunks(
      chunks,
      ['技术方案', '技术响应', '实施方案', '总体设计', '系统架构', '方案设计'],
      5,
    );

    return groups
      .filter((group) => this.mergeChunkContent(group.chunks).trim().length > 0)
      .map((group, index, all) => {
        const suffix = all.length > 1 ? `-${group.label}` : '';
        const title = `${bidName}-技术方案${suffix}`;
        const content = this.mergeChunkContent(group.chunks);
        return {
          status: 'completed' as const,
          targetCategory: 'solution',
          targetSubtype: 'technical_solution',
          title,
          content,
          sourceQuote: this.trimText(content, 220),
          sourceOutline: group.label,
          sourceBlockIds: group.chunks.flatMap((chunk) => chunk.sourceBlockIds),
          sourceChunkIds: group.chunks.map((chunk) => chunk.id),
          metadata: {
            groupIndex: index + 1,
          },
        };
      });
  }

  private async buildResumeDrafts(bidName: string, chunks: PersistedChunkRef[]) {
    const groups = this.groupCandidateChunks(
      chunks,
      ['简历', '人员简历', '项目负责人简历', '主要人员', '项目组成员', '姓名'],
      8,
    );

    const results: IngestDraftItem[] = [];
    for (const group of groups) {
      const content = this.mergeChunkContent(group.chunks);
      if (!content.trim()) {
        continue;
      }

      const headingRole = this.extractResumeHeadingRole(group.label);
      const identity = await this.extractResumeIdentity(content, group.label, headingRole);
      const titlePosition = headingRole || identity.position;
      const name = identity.name?.trim();
      if (name) {
        results.push({
          status: 'completed',
          targetCategory: 'resume',
          targetSubtype: 'person_resume',
          title: this.buildResumeTitle(name, identity.company, titlePosition, bidName),
          content,
          sourceQuote: this.trimText(content, 220),
          sourceOutline: group.label,
          sourceBlockIds: group.chunks.flatMap((chunk) => chunk.sourceBlockIds),
          sourceChunkIds: group.chunks.map((chunk) => chunk.id),
          metadata: {
            name,
            company: identity.company,
            position: titlePosition,
          },
        });
        continue;
      }

      results.push({
        status: 'pending_review',
        suggestedCategory: 'resume',
        suggestedSubtype: 'person_resume',
        title: this.buildResumeTitle(undefined, identity.company, titlePosition, bidName),
        content,
        sourceQuote: this.trimText(content, 220),
        sourceOutline: group.label,
        sourceBlockIds: group.chunks.flatMap((chunk) => chunk.sourceBlockIds),
        sourceChunkIds: group.chunks.map((chunk) => chunk.id),
        metadata: {
          reason: 'resume_name_missing',
          company: identity.company,
          position: titlePosition,
          bidName,
        },
      });
    }

    return results;
  }

  private async buildPerformanceDrafts(chunks: PersistedChunkRef[]) {
    const groups = this.groupCandidateChunks(
      chunks,
      ['项目业绩', '类似业绩', '同类项目', '案例', '实施案例', '合同'],
      8,
    );

    const results: IngestDraftItem[] = [];
    for (const group of groups) {
      const content = this.mergeChunkContent(group.chunks);
      if (!content.trim()) {
        continue;
      }

      const customer = await this.extractPerformanceCustomer(content, group.label);
      const moduleName = await this.extractPerformanceModule(content, group.label);

      if (customer && moduleName) {
        results.push({
          status: 'completed',
          targetCategory: 'performance',
          targetSubtype: 'project_performance',
          title: `${customer}-${moduleName}`,
          content,
          sourceQuote: this.trimText(content, 220),
          sourceOutline: group.label,
          sourceBlockIds: group.chunks.flatMap((chunk) => chunk.sourceBlockIds),
          sourceChunkIds: group.chunks.map((chunk) => chunk.id),
          metadata: {
            customer,
            moduleName,
          },
        });
        continue;
      }

      results.push({
        status: 'pending_review',
        suggestedCategory: 'performance',
        suggestedSubtype: 'project_performance',
        title: `${customer || '待确认客户'}-${moduleName || '待确认模块'}`,
        content,
        sourceQuote: this.trimText(content, 220),
        sourceOutline: group.label,
        sourceBlockIds: group.chunks.flatMap((chunk) => chunk.sourceBlockIds),
        sourceChunkIds: group.chunks.map((chunk) => chunk.id),
        metadata: {
          reason: 'performance_name_missing',
          customer,
          moduleName,
        },
      });
    }

    return results;
  }

  private async buildWinningDrafts(bidName: string, chunks: PersistedChunkRef[]) {
    const groups = this.groupCandidateChunks(
      chunks,
      ['中标', '中标通知书', '中标案例', '中选', '中标公告'],
      5,
    );

    const results: IngestDraftItem[] = [];
    for (const group of groups) {
      const content = this.mergeChunkContent(group.chunks);
      if (!/(中标|中选|中标通知书|中标公告)/.test(content)) {
        continue;
      }

      const customer = (await this.extractWinningCustomer(content, group.label)) || bidName;
      results.push({
        status: 'completed',
        targetCategory: 'winning',
        targetSubtype: 'winning_case',
        title: `${customer}-中标案例`,
        content,
        sourceQuote: this.trimText(content, 220),
        sourceOutline: group.label,
        sourceBlockIds: group.chunks.flatMap((chunk) => chunk.sourceBlockIds),
        sourceChunkIds: group.chunks.map((chunk) => chunk.id),
        metadata: {
          customer,
        },
      });
    }

    return results;
  }

  private dedupeDrafts(items: IngestDraftItem[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = [
        item.status,
        item.targetCategory || item.suggestedCategory || '',
        item.targetSubtype || item.suggestedSubtype || '',
        item.title || '',
        this.trimText(item.content, 120),
      ].join('::');

      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private findDocxHeadingIndex(entries: DocxBodyEntry[], keywords: readonly string[]) {
    for (const entry of entries) {
      const text = entry.text.trim();
      if (!text || this.isLikelyDocxTocEntry(text) || !this.isStructuralHeadingText(text)) {
        continue;
      }
      if (keywords.some((keyword) => text.includes(keyword))) {
        return entry.index;
      }
    }
    return -1;
  }

  private sliceDocxSection(entries: DocxBodyEntry[], headingIndex: number) {
    const heading = entries[headingIndex]?.text?.trim() ?? '';
    const currentLevel = this.getStructuralHeadingLevel(heading);
    let startIndex = headingIndex;

    const parentIndex = headingIndex - 1;
    if (parentIndex >= 0) {
      const parentText = entries[parentIndex]?.text?.trim() ?? '';
      const parentLevel = this.getStructuralHeadingLevel(parentText);
      if (
        parentText &&
        !this.isLikelyDocxTocEntry(parentText) &&
        this.isStructuralHeadingText(parentText) &&
        parentLevel !== null &&
        currentLevel !== null &&
        parentLevel < currentLevel &&
        parentText.length <= 24
      ) {
        startIndex = parentIndex;
      }
    }

    let endIndex = entries.length - 1;
    for (let index = headingIndex + 1; index < entries.length; index += 1) {
      const text = entries[index]?.text?.trim() ?? '';
      if (!text || this.isLikelyDocxTocEntry(text)) {
        continue;
      }
      if (this.shouldStopDocxSection(text, currentLevel)) {
        endIndex = index - 1;
        break;
      }
    }

    const content = entries
      .slice(startIndex, endIndex + 1)
      .map((entry) => entry.text.trim())
      .filter(Boolean)
      .join('\n');

    return {
      heading,
      content,
      startIndex,
      endIndex,
    };
  }

  private shouldStopDocxSection(text: string, currentLevel: number | null) {
    if (!this.isStructuralHeadingText(text)) {
      return false;
    }

    const nextLevel = this.getStructuralHeadingLevel(text);
    if (currentLevel === null || nextLevel === null) {
      return true;
    }
    return nextLevel <= currentLevel;
  }

  private isLikelyDocxTocEntry(text: string) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact || compact === '目录') {
      return false;
    }

    return (
      /^(\d+(?:[.．]\d+)*|\d+[）)、.．]|[一二三四五六七八九十]+[）)、.．]).*\s\d{1,4}$/.test(compact) ||
      /^(\d+）|\d+\.)\s*.+\s\d{1,4}$/.test(compact)
    );
  }

  private isStructuralHeadingText(text: string) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact || compact.length > 60 || /[。；;！？!?]$/.test(compact)) {
      return false;
    }

    if (compact === '目录' || compact === '公司介绍') {
      return true;
    }

    return (
      /^\d+(?:[.．]\d+)+\s*[\u4E00-\u9FA5A-Za-z（(]/.test(compact) ||
      /^\d+[.．]\s*[\u4E00-\u9FA5A-Za-z（(]/.test(compact) ||
      /^\d+\s*[）)、]\s*[\u4E00-\u9FA5A-Za-z（(]/.test(compact) ||
      /^\d+\s+[\u4E00-\u9FA5A-Za-z（(]/.test(compact) ||
      /^第[一二三四五六七八九十百零]+[章节篇部分]/.test(compact)
    );
  }

  private getStructuralHeadingLevel(text: string) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact || this.isLikelyDocxTocEntry(compact)) {
      return null;
    }

    const multiLevel = compact.match(/^(\d+(?:[.．]\d+)+)/);
    if (multiLevel) {
      return multiLevel[1].split(/[.．]/).length;
    }

    if (/^\d+[.．]\s*[\u4E00-\u9FA5A-Za-z（(]/.test(compact)) {
      return 1;
    }

    if (/^\d+\s*[）)、]\s*[\u4E00-\u9FA5A-Za-z（(]/.test(compact)) {
      return 2;
    }

    if (/^\d+\s+[\u4E00-\u9FA5A-Za-z（(]/.test(compact) || /^第[一二三四五六七八九十百零]+[章节篇部分]/.test(compact)) {
      return 1;
    }

    return null;
  }

  private isResumeSectionBoundary(text: string) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact || this.isLikelyDocxTocEntry(compact) || this.isDocxResumeHeading(compact)) {
      return false;
    }

    return /^\d+(?:[.．]\d+)+\s*[\u4E00-\u9FA5A-Za-z（(]/.test(compact) || /^\d+\s+[^\d\s]/.test(compact);
  }

  private isDocxResumeHeading(text: string) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact || compact.includes('项目成员清单') || compact.includes('项目成员简历') || compact.length > 40) {
      return false;
    }

    const hasResumePrefix =
      /^\d+\s*[）)、]\s*/.test(compact) || /^[一二三四五六七八九十]+\s*[）)、]\s*/.test(compact);
    const hasRoleKeyword = RESUME_ROLE_KEYWORDS.some((keyword) => compact.includes(keyword));

    return hasResumePrefix && (compact.includes('简历') || hasRoleKeyword);
  }

  private extractResumeHeadingRole(text: string) {
    const normalized = text
      .replace(/^\d+\s*[）)、.]?\s*/, '')
      .replace(/^[一二三四五六七八九十]+\s*[）)、.]?\s*/, '')
      .replace(/简历$/u, '')
      .trim();

    if (!normalized || /^\d+$/.test(normalized) || normalized.includes('项目成员')) {
      return '';
    }
    return normalized;
  }

  private groupCandidateChunks(chunks: PersistedChunkRef[], keywords: readonly string[], limit: number) {
    const candidates = this.pickTopChunks(chunks, keywords, limit);
    const groups = new Map<string, ChunkGroup>();

    for (const chunk of candidates) {
      const label = this.getLastSectionLabel(chunk.sectionPath) || `分段-${groups.size + 1}`;
      const groupKey = label.toLowerCase();
      const current = groups.get(groupKey);
      if (current) {
        current.chunks.push(chunk);
      } else {
        groups.set(groupKey, {
          key: groupKey,
          label,
          chunks: [chunk],
        });
      }
    }

    return Array.from(groups.values());
  }

  private pickTopChunks(chunks: PersistedChunkRef[], keywords: readonly string[], limit: number) {
    return [...chunks]
      .map((chunk) => ({
        chunk,
        score: this.scoreText(`${chunk.sectionPath ?? ''}\n${chunk.text}`, keywords),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return (right.chunk.importanceScore ?? 0) - (left.chunk.importanceScore ?? 0);
      })
      .slice(0, limit)
      .map((entry) => entry.chunk);
  }

  private mergeChunkContent(chunks: PersistedChunkRef[]) {
    return chunks
      .map((chunk) => chunk.text.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  private scoreText(text: string, keywords: readonly string[]) {
    return keywords.reduce((score, keyword) => (text.includes(keyword) ? score + 1 : score), 0);
  }

  private getLastSectionLabel(sectionPath?: string | null) {
    return (sectionPath ?? '')
      .split(/>|\/|\\|::/)
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1) ?? '';
  }

  private async extractResumeIdentity(content: string, label: string, fallbackRole = '') {
    const directName =
      content.match(
        /(?:姓名|人员名称|项目负责人)\s*[：:]?\s*([A-Za-z\u4E00-\u9FA5·]{2,20}?)(?=\s*(?:性别|出生年月|籍贯|民族|学历|专业|毕业学校|职称|技术级别|专业能力|工作经验|联系方式|手机|邮箱|$))/i,
      )?.[1]?.trim() ??
      content.match(/([A-Za-z\u4E00-\u9FA5·]{2,20})\s*简历/i)?.[1]?.trim() ??
      label.match(/([A-Za-z\u4E00-\u9FA5·]{2,20})\s*简历/i)?.[1]?.trim() ??
      '';
    const name = this.isGenericResumeName(directName) ? '' : directName;
    const company =
      this.cleanEntityName(
        content.match(/(?:工作单位|任职单位|所在单位|供职单位|单位)\s*[：:]\s*([^\n，,；;]{2,80})/i)?.[1],
      ) || '';
    const position =
      this.cleanEntityName(
        content.match(
          /(?:职务|职位|岗位|项目角色|担任|职称|本项目职务)\s*[：:]?\s*([A-Za-z\u4E00-\u9FA5·]{1,40}?)(?=\s*(?:技术级别|专业能力|工作经验|联系方式|姓名|性别|出生年月|籍贯|民族|学历|专业|毕业学校|手机|邮箱|$))/i,
        )?.[1],
      ) || '';

    if (name && (company || position)) {
      return { name, company, position };
    }

    const aiResult = await this.ai.chatJson<{ name?: string; company?: string; position?: string }>({
      task: 'default',
      systemPrompt: [
        'You extract resume identity fields from a Chinese resume section.',
        'Return JSON only.',
        'Schema: {"name":"person name","company":"company or employer","position":"job title"}',
        'If any field cannot be confirmed, return an empty string for that field.',
      ].join('\n'),
      userContent: JSON.stringify({
        sectionTitle: label,
        content: this.trimText(content, 2200),
      }),
      temperature: 0.1,
      maxTokens: 400,
    });

    return {
      name: name || (this.isGenericResumeName(aiResult?.name) ? '' : aiResult?.name?.trim()) || '',
      company: company || this.cleanEntityName(aiResult?.company),
      position: position || this.cleanEntityName(aiResult?.position) || fallbackRole,
    };
  }

  private async extractPerformanceCustomer(content: string, label: string) {
    const direct =
      content.match(/(?:客户名称|建设单位|采购人|用户单位|业主单位)\s*[：:]\s*([^\n，,；;]{2,60})/i)?.[1] ??
      label.match(/([^\-—]{2,60}公司)/)?.[1];
    if (direct) {
      return this.cleanEntityName(direct);
    }

    const aiResult = await this.ai.chatJson<{ customerName?: string }>({
      task: 'default',
      systemPrompt: [
        'You extract the customer or owner company name from a project performance section.',
        'Return JSON only.',
        'Schema: {"customerName":"name"}',
        'If missing, return {"customerName":""}.',
      ].join('\n'),
      userContent: JSON.stringify({
        sectionTitle: label,
        content: this.trimText(content, 1800),
      }),
      temperature: 0.1,
      maxTokens: 300,
    });

    return this.cleanEntityName(aiResult?.customerName);
  }

  private async extractPerformanceModule(content: string, label: string) {
    const direct =
      content.match(/(?:产品模块|采购模块|系统模块|功能模块|模块)\s*[：:]\s*([^\n，,；;]{1,40})/i)?.[1] ??
      label.match(/(1104|一表通|监管报送|数据治理|风控|信贷|财务|云平台)/i)?.[1];
    if (direct) {
      return this.cleanEntityName(direct);
    }

    const aiResult = await this.ai.chatJson<{ moduleName?: string }>({
      task: 'default',
      systemPrompt: [
        'You extract the product or business module name from a project performance section.',
        'Return JSON only.',
        'Schema: {"moduleName":"module"}',
        'If missing, return {"moduleName":""}.',
      ].join('\n'),
      userContent: JSON.stringify({
        sectionTitle: label,
        content: this.trimText(content, 1800),
      }),
      temperature: 0.1,
      maxTokens: 300,
    });

    return this.cleanEntityName(aiResult?.moduleName);
  }

  private async extractWinningCustomer(content: string, label: string) {
    const direct =
      content.match(/(?:中标单位|采购人|客户名称|招标人)\s*[：:]\s*([^\n，,；;]{2,60})/i)?.[1] ??
      label.match(/([^\-—]{2,60}公司)/)?.[1];
    if (direct) {
      return this.cleanEntityName(direct);
    }

    const aiResult = await this.ai.chatJson<{ customerName?: string }>({
      task: 'default',
      systemPrompt: [
        'You extract the customer name from a winning case section.',
        'Return JSON only.',
        'Schema: {"customerName":"name"}',
        'If missing, return {"customerName":""}.',
      ].join('\n'),
      userContent: JSON.stringify({
        sectionTitle: label,
        content: this.trimText(content, 1800),
      }),
      temperature: 0.1,
      maxTokens: 300,
    });

    return this.cleanEntityName(aiResult?.customerName);
  }

  private cleanEntityName(value?: string | null) {
    const normalized = (value ?? '')
      .replace(/^[：:\s-]+/, '')
      .replace(/[；;。,\s]+$/, '')
      .trim();
    return normalized || '';
  }

  private isGenericResumeName(value?: string | null) {
    const normalized = (value ?? '').trim();
    if (!normalized) {
      return true;
    }

    return (
      RESUME_ROLE_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
      ['项目负责人', '负责人', '项目成员', '人员简历', '简历', '业务咨询团队', '顾问管理团队'].includes(normalized)
    );
  }

  private buildResumeTitle(name: string | undefined, company: string | undefined, position: string | undefined, bidName: string) {
    const companyAndPosition = company ? `${company}${position || ''}` : (position ?? '');
    return `${name?.trim() || '待确认姓名'}-${companyAndPosition || '待确认单位职位'}-${bidName}-简历`;
  }

  private async createGeneratedAsset(params: {
    jobId: string;
    category: string;
    subtype: string;
    title: string;
    content: string;
    uploadedBy: string;
    sourceDocumentVersionId?: string;
    sourceDocxRange?: DocxEntryRange;
    sourceBlockIds?: string[];
    sourceOutline?: string;
    metadata?: Record<string, unknown>;
  }) {
    const asset = await this.prisma.asset.create({
      data: {
        category: params.category,
        subtype: params.subtype,
        title: params.title,
        content: params.content,
        snippet: params.content.slice(0, 200),
        sourceMode: 'ingest_generated',
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
        ingestJobId: params.jobId,
        uploadedBy: params.uploadedBy,
      },
    });

    const fileName = `${this.safeFileName(params.title)}.docx`;
    const buffer = await this.buildGeneratedBuffer({
      title: params.title,
      content: params.content,
      sourceDocumentVersionId: params.sourceDocumentVersionId,
      sourceDocxRange: params.sourceDocxRange,
      sourceBlockIds: params.sourceBlockIds ?? [],
      sourceOutline: params.sourceOutline,
    });
    const storedObject = await this.storage.uploadBuffer(
      `assets/generated/${params.jobId}/${Date.now()}_${fileName}`,
      buffer,
      {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    );

    await this.documentService.createAssetDocument({
      assetId: asset.id,
      title: params.title,
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: buffer.length,
      storageBucket: storedObject.bucket,
      storageKey: storedObject.key,
      uploadedBy: params.uploadedBy,
      fileBuffer: buffer,
      bizCategory: this.resolveBizCategory(params.category),
      status: DocumentStatus.READY,
    });

    return asset.id;
  }

  private async buildGeneratedBuffer(params: {
    title: string;
    content: string;
    sourceDocumentVersionId?: string;
    sourceDocxRange?: DocxEntryRange;
    sourceBlockIds: string[];
    sourceOutline?: string;
  }) {
    if (params.sourceDocumentVersionId && params.sourceDocxRange) {
      const exact = await this.buildPreservedWordBufferByDocxRange(
        params.sourceDocumentVersionId,
        params.sourceDocxRange,
      );
      if (exact) {
        return exact;
      }
    }

    if (params.sourceDocumentVersionId && params.sourceBlockIds.length > 0) {
      const exact = await this.buildPreservedWordBuffer(params.sourceDocumentVersionId, params.sourceBlockIds, [
        params.sourceOutline ?? '',
        params.title,
      ]);
      if (exact) {
        return exact;
      }
    }
    return this.buildWordBuffer(params.title, params.content);
  }

  private async buildPreservedWordBufferByDocxRange(
    sourceDocumentVersionId: string,
    range: DocxEntryRange,
  ) {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: sourceDocumentVersionId },
      include: {
        document: {
          select: {
            fileExt: true,
          },
        },
      },
    });

    if (!version) {
      return null;
    }

    const ext = this.safeExt(version.fileName || version.document.fileExt || '');
    if (ext !== 'docx') {
      return null;
    }

    const buffer = await this.storage.getObjectBuffer(version.storageBucket, version.storageKey);
    return extractDocxEntryRangeBuffer(buffer, range.startIndex, range.endIndex);
  }

  private async buildPreservedWordBuffer(
    sourceDocumentVersionId: string,
    sourceBlockIds: string[],
    hintTexts: string[],
  ) {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: sourceDocumentVersionId },
      include: {
        document: {
          select: {
            fileExt: true,
          },
        },
      },
    });

    if (!version) {
      return null;
    }

    const ext = this.safeExt(version.fileName || version.document.fileExt || '');
    if (ext !== 'docx') {
      return null;
    }

    const blocks = await this.prisma.documentBlock.findMany({
      where: {
        id: {
          in: Array.from(new Set(sourceBlockIds)),
        },
      },
      include: {
        page: true,
      },
      orderBy: [
        { page: { pageNo: 'asc' } },
        { paragraphNo: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const blockTexts = blocks.map((block) => block.text).filter(Boolean);
    if (blockTexts.length === 0) {
      return null;
    }

    const buffer = await this.storage.getObjectBuffer(version.storageBucket, version.storageKey);
    return extractDocxSubsetBuffer(buffer, blockTexts, hintTexts);
  }

  private async buildWordBuffer(title: string, content: string) {
    const paragraphs = content
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => new Paragraph({ children: [new TextRun(line)] }));

    const document = new WordDocument({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: title,
              heading: HeadingLevel.HEADING_1,
            }),
            ...paragraphs,
          ],
        },
      ],
    });

    return Packer.toBuffer(document);
  }

  private resolveBizCategory(category: string) {
    switch (category) {
      case 'qualification':
        return DocumentBizCategory.QUALIFICATION;
      case 'solution':
      case 'winning':
      case 'performance':
        return DocumentBizCategory.CASE_STUDY;
      default:
        return DocumentBizCategory.OTHER;
    }
  }

  private async refreshJobSummary(jobId: string, progress = 100) {
    const existingJob = await this.prisma.libraryIngestJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (!existingJob) {
      return;
    }

    const items = await this.prisma.libraryIngestItem.findMany({
      where: { jobId },
      select: { status: true },
    });

    const successCount = items.filter((item) => item.status === 'completed').length;
    const unresolvedCount = items.filter((item) => item.status === 'pending_review').length;
    const status: IngestStatus | 'completed' =
      existingJob.status === 'completed' ? 'completed' : unresolvedCount > 0 ? 'partial_review' : 'succeeded';

    await this.prisma.libraryIngestJob.update({
      where: { id: jobId },
      data: {
        status,
        progress,
        successCount,
        unresolvedCount,
        completedAt: new Date(),
      },
    });
  }

  private toJobSummary(job: {
    id: string;
    status: string;
    progress: number;
    sourceFileName: string;
    archiveMirrored: boolean;
    successCount: number;
    unresolvedCount: number;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      sourceFileName: normalizeUploadedFileName(job.sourceFileName),
      archiveMirrored: job.archiveMirrored,
      successCount: job.successCount,
      unresolvedCount: job.unresolvedCount,
      errorMessage: job.errorMessage ?? undefined,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? undefined,
    };
  }

  private toJobItem(item: {
    id: string;
    status: string;
    targetCategory: string | null;
    targetSubtype: string | null;
    suggestedCategory: string | null;
    suggestedSubtype: string | null;
    suggestedTitle: string | null;
    finalTitle: string | null;
    sourceQuote: string | null;
    sourceOutline: string | null;
    content: string | null;
    assetId: string | null;
    metadata: Prisma.JsonValue | null;
    asset?: {
      id: string;
      category: string;
      subtype: string | null;
      title: string;
      documents?: Array<{ currentVersion: { id: string } | null }>;
    } | null;
  }) {
    const downloadable = Boolean(item.asset?.documents?.[0]?.currentVersion);
    return {
      id: item.id,
      status: item.status,
      targetCategory: item.targetCategory ?? undefined,
      targetSubtype: item.targetSubtype ?? undefined,
      suggestedCategory: item.suggestedCategory ?? undefined,
      suggestedSubtype: item.suggestedSubtype ?? undefined,
      suggestedTitle: normalizePossiblyMojibakeText(item.suggestedTitle) || undefined,
      finalTitle: normalizePossiblyMojibakeText(item.finalTitle) || undefined,
      sourceQuote: item.sourceQuote ?? undefined,
      sourceOutline: item.sourceOutline ?? undefined,
      content: item.content ?? undefined,
      metadata: item.metadata ?? undefined,
      assetId: item.assetId ?? undefined,
      downloadable,
      downloadUrl: item.assetId && downloadable ? `/api/assets/${item.assetId}/download` : undefined,
    };
  }

  private toJobAsset(asset: {
    id: string;
    title: string;
    category: string;
    subtype: string | null;
    sourceMode: string | null;
    uploadedAt: Date;
    documents?: Array<{ currentVersion: { id: string } | null }>;
  }) {
    const downloadable = Boolean(asset.documents?.[0]?.currentVersion);
    return {
      id: asset.id,
      title: normalizePossiblyMojibakeText(asset.title),
      category: asset.category,
      subtype: asset.subtype ?? undefined,
      sourceMode: asset.sourceMode ?? undefined,
      uploadedAt: asset.uploadedAt.toISOString(),
      downloadable,
      downloadUrl: downloadable ? `/api/assets/${asset.id}/download` : undefined,
    };
  }

  private trimText(text: string, maxLength: number) {
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}...`;
  }

  private safeExt(fileName: string) {
    return fileName.split('.').pop()?.toLowerCase() ?? '';
  }

  private baseName(fileName: string) {
    return normalizeUploadedFileName(fileName).replace(/\.[^.]+$/, '').trim();
  }

  private safeFileName(fileName: string) {
    return buildSafeFileName(fileName);
  }

  private extractDocxRangeFromMetadata(value: Record<string, unknown> | Prisma.JsonValue | null | undefined) {
    const rangeValue =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).docxEntryRange
        : null;

    if (!rangeValue || typeof rangeValue !== 'object' || Array.isArray(rangeValue)) {
      return undefined;
    }

    const record = rangeValue as Record<string, unknown>;
    const startIndex = typeof record.startIndex === 'number' ? record.startIndex : Number(record.startIndex);
    const endIndex = typeof record.endIndex === 'number' ? record.endIndex : Number(record.endIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || endIndex < startIndex) {
      return undefined;
    }

    return {
      startIndex,
      endIndex,
    };
  }

  private toRecord(value: Prisma.JsonValue | null | undefined) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toStringArray(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
  }
}
