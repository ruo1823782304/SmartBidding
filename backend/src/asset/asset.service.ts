import { Injectable, NotFoundException } from '@nestjs/common';
import { DocumentBizCategory, DocumentStatus, Prisma, type Asset as PrismaAsset } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentService } from '../document/document.service';
import { normalizePossiblyMojibakeText, normalizeUploadedFileName } from './file-name.util';

type AssetListFilters = {
  subtype?: string;
  sourceMode?: string;
  jobId?: string;
};

@Injectable()
export class AssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly documentService: DocumentService,
  ) {}

  async list(
    category?: string,
    keyword?: string,
    page = 1,
    pageSize = 20,
    filters: AssetListFilters = {},
  ) {
    const where: Prisma.AssetWhereInput = {};
    if (category) {
      where.category = category;
    }
    if (filters.subtype) {
      where.subtype = filters.subtype;
    }
    if (filters.sourceMode) {
      where.sourceMode = filters.sourceMode;
    }
    if (filters.jobId) {
      where.ingestJobId = filters.jobId;
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { snippet: { contains: keyword, mode: 'insensitive' } },
        { content: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [list, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { uploadedAt: 'desc' },
        include: {
          documents: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: {
              currentVersion: true,
            },
          },
        },
      }),
      this.prisma.asset.count({ where }),
    ]);

    return {
      list: list.map((asset) => this.toAssetListItem(asset)),
      total,
    };
  }

  async create(
    category: string,
    title: string,
    uploadedBy: string,
    file?: Express.Multer.File,
    content?: string,
    tags?: string[],
    extra: {
      subtype?: string;
      sourceMode?: string;
      metadata?: Prisma.InputJsonValue;
      ingestJobId?: string;
    } = {},
  ) {
    const normalizedFileName = file?.originalname ? normalizeUploadedFileName(file.originalname) : undefined;
    const fallbackTitle = normalizedFileName
      ? normalizePossiblyMojibakeText(normalizedFileName.replace(/\.[^.]+$/, '')) || 'Untitled Asset'
      : 'Untitled Asset';
    const normalizedTitle = normalizePossiblyMojibakeText(title) || fallbackTitle;
    const asset = await this.prisma.asset.create({
      data: {
        category,
        subtype: extra.subtype,
        title: normalizedTitle,
        fileUrl: file ? undefined : undefined,
        content,
        snippet: content ? content.slice(0, 200) : undefined,
        tags: tags ?? [],
        sourceMode: extra.sourceMode ?? 'manual',
        metadata: extra.metadata,
        ingestJobId: extra.ingestJobId,
        uploadedBy,
      },
      include: {
        documents: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { currentVersion: true },
        },
      },
    });

    if (file?.buffer?.length) {
      const fileName = normalizedFileName ?? `${normalizedTitle}.bin`;
      const storedObject = await this.storage.uploadBuffer(
        `assets/manual/${category}/${Date.now()}_${this.toStorageSafeFileName(fileName)}`,
        file.buffer,
        file.mimetype ? { 'Content-Type': file.mimetype } : undefined,
      );

      await this.documentService.createAssetDocument({
        assetId: asset.id,
        title: normalizedTitle,
        fileName,
        mimeType: file.mimetype || this.guessMimeType(undefined, fileName),
        fileSize: file.size,
        storageBucket: storedObject.bucket,
        storageKey: storedObject.key,
        uploadedBy,
        fileBuffer: file.buffer,
        bizCategory: this.resolveBizCategory(category),
        status: DocumentStatus.READY,
      });
    }

    const latestAsset = await this.prisma.asset.findUnique({
      where: { id: asset.id },
      include: {
        documents: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { currentVersion: true },
        },
      },
    });

    return {
      success: true,
      asset: this.toAssetListItem(latestAsset ?? asset),
    };
  }

  async update(id: string, data: { title?: string; tags?: string[]; content?: string }) {
    const normalizedTitle =
      data.title !== undefined ? normalizePossiblyMojibakeText(data.title) || 'Untitled Asset' : undefined;
    await this.prisma.asset.update({
      where: { id },
      data: {
        ...(normalizedTitle !== undefined && { title: normalizedTitle }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.content !== undefined && { content: data.content, snippet: data.content.slice(0, 200) }),
      },
    });
    return { success: true };
  }

  async delete(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        documents: {
          include: {
            versions: true,
          },
        },
        ingestItems: {
          select: {
            id: true,
            jobId: true,
          },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('资产不存在。');
    }

    const storageRefs = asset.documents.flatMap((document) =>
      document.versions.map((version) => ({
        versionId: version.id,
        bucket: version.storageBucket,
        key: version.storageKey,
      })),
    );
    const affectedJobIds = Array.from(
      new Set(
        [asset.ingestJobId, ...asset.ingestItems.map((item) => item.jobId)].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );

    await this.prisma.$transaction(async (tx) => {
      if (asset.ingestItems.length > 0) {
        await tx.libraryIngestItem.deleteMany({
          where: { assetId: asset.id },
        });
      }

      if (asset.documents.length > 0) {
        await tx.document.deleteMany({
          where: {
            id: {
              in: asset.documents.map((document) => document.id),
            },
          },
        });
      }

      await tx.asset.delete({
        where: { id: asset.id },
      });
    });

    for (const ref of storageRefs) {
      const remaining = await this.prisma.documentVersion.count({
        where: {
          id: { not: ref.versionId },
          storageBucket: ref.bucket,
          storageKey: ref.key,
        },
      });
      if (remaining === 0) {
        await this.storage.deleteObject(ref.bucket, ref.key);
      }
    }

    for (const jobId of affectedJobIds) {
      await this.refreshIngestJobSummary(jobId);
    }

    return { success: true };
  }

  async batchClassify(files: Express.Multer.File[]) {
    return {
      success: true,
      total: files.length,
      message: '批量归档分类接口暂未启用自动分类，本次保留兼容响应。',
    };
  }

  async downloadAsset(id: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        assetId: id,
        currentVersionId: { not: null },
      },
      include: {
        currentVersion: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!document?.currentVersion) {
      throw new NotFoundException('资产文件不存在。');
    }

    const buffer = await this.storage.getObjectBuffer(
      document.currentVersion.storageBucket,
      document.currentVersion.storageKey,
    );

    return {
      buffer,
      fileName: normalizeUploadedFileName(document.currentVersion.fileName),
      mimeType: document.mimeType ?? this.guessMimeType(document.fileExt, document.currentVersion.fileName),
    };
  }

  async ensureUniqueTitle(category: string, subtype: string | null | undefined, baseTitle: string) {
    const normalized = normalizePossiblyMojibakeText(baseTitle) || 'Untitled Asset';
    let candidate = normalized;
    let suffix = 2;

    while (
      await this.prisma.asset.findFirst({
        where: {
          category,
          subtype: subtype ?? null,
          title: candidate,
        },
        select: { id: true },
      })
    ) {
      candidate = `${normalized}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  private toAssetListItem(
    asset: PrismaAsset & {
      documents?: Array<{
        id: string;
        currentVersionId: string | null;
        currentVersion: {
          id: string;
          fileName: string;
        } | null;
      }>;
    },
  ) {
    const currentDocument = asset.documents?.[0];
    const hasDownload = Boolean(currentDocument?.currentVersion);

    return {
      id: asset.id,
      title: normalizePossiblyMojibakeText(asset.title),
      category: asset.category,
      subtype: asset.subtype ?? undefined,
      sourceMode: asset.sourceMode ?? 'manual',
      fileUrl: asset.fileUrl ?? undefined,
      snippet: asset.snippet ?? undefined,
      tags: (asset.tags as string[]) ?? [],
      metadata: asset.metadata ?? undefined,
      ingestJobId: asset.ingestJobId ?? undefined,
      uploadedAt: asset.uploadedAt.toISOString(),
      uploadedBy: asset.uploadedBy ?? undefined,
      downloadUrl: hasDownload ? `/api/assets/${asset.id}/download` : undefined,
      downloadable: hasDownload,
    };
  }

  private async refreshIngestJobSummary(jobId: string) {
    const job = await this.prisma.libraryIngestJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true },
    });

    if (!job) {
      return;
    }

    const items = await this.prisma.libraryIngestItem.findMany({
      where: { jobId },
      select: { status: true },
    });
    const successCount = items.filter((item) => item.status === 'completed').length;
    const unresolvedCount = items.filter((item) => item.status === 'pending_review').length;
    const status =
      job.status === 'completed'
        ? 'completed'
        : items.length === 0
          ? 'pending'
          : unresolvedCount > 0
            ? 'partial_review'
            : 'succeeded';

    await this.prisma.libraryIngestJob.update({
      where: { id: jobId },
      data: {
        successCount,
        unresolvedCount,
        status,
        completedAt: items.length === 0 ? null : new Date(),
      },
    });
  }

  private guessMimeType(fileExt?: string | null, fileName?: string | null) {
    const ext = (fileExt || fileName?.split('.').at(-1) || '').toLowerCase();
    switch (ext) {
      case 'pdf':
        return 'application/pdf';
      case 'docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'doc':
        return 'application/msword';
      case 'txt':
        return 'text/plain; charset=utf-8';
      default:
        return 'application/octet-stream';
    }
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

  private toStorageSafeFileName(fileName: string) {
    return fileName.replace(/[^\w.\-()\u4e00-\u9fa5]+/g, '_');
  }
}
