import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  async list(category?: string, keyword?: string, page = 1, pageSize = 20) {
    const where: Record<string, unknown> = {};
    if (category) {
      where.category = category;
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword, mode: 'insensitive' } },
        { snippet: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [list, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { uploadedAt: 'desc' },
      }),
      this.prisma.asset.count({ where }),
    ]);

    return {
      list: list.map((asset) => ({
        id: asset.id,
        title: asset.title,
        category: asset.category,
        fileUrl: asset.fileUrl ?? undefined,
        snippet: asset.snippet ?? undefined,
        tags: (asset.tags as string[]) ?? [],
        uploadedAt: asset.uploadedAt.toISOString(),
        uploadedBy: asset.uploadedBy ?? undefined,
      })),
      total,
    };
  }

  async create(
    category: string,
    title: string,
    uploadedBy: string,
    fileUrl?: string,
    content?: string,
    tags?: string[],
  ) {
    const asset = await this.prisma.asset.create({
      data: {
        category,
        title: title || 'Untitled Asset',
        fileUrl,
        content,
        snippet: content ? content.slice(0, 200) : undefined,
        tags: tags ?? [],
        uploadedBy,
      },
    });

    return {
      success: true,
      asset: {
        id: asset.id,
        title: asset.title,
        category: asset.category,
        fileUrl: asset.fileUrl ?? undefined,
        snippet: asset.snippet ?? undefined,
        tags: (asset.tags as string[]) ?? [],
        uploadedAt: asset.uploadedAt.toISOString(),
        uploadedBy: asset.uploadedBy ?? undefined,
      },
    };
  }

  async update(id: string, data: { title?: string; tags?: string[]; content?: string }) {
    await this.prisma.asset.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.content !== undefined && { content: data.content, snippet: data.content.slice(0, 200) }),
      },
    });
    return { success: true };
  }

  async delete(id: string) {
    await this.prisma.asset.delete({ where: { id } });
    return { success: true };
  }

  async batchClassify(_files: Express.Multer.File[]) {
    return { success: true, taskId: `batch-${Date.now()}` };
  }
}
