import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [projectTotal, done, ongoing] = await Promise.all([
      this.prisma.project.count({ where: { archivedAt: null } }),
      this.prisma.project.count({ where: { status: 'done', archivedAt: null } }),
      this.prisma.project.count({ where: { status: { in: ['ongoing', 'review'] }, archivedAt: null } }),
    ]);
    return {
      projectTotal,
      winCount: done,
      ongoingCount: ongoing,
      trend: { labels: [] as string[], values: [] as number[] },
    };
  }

  async getReviewList(projectId?: string, keyword?: string) {
    const where: { projectId?: string; project?: { name?: { contains: string; mode: 'insensitive' } } } = {};
    if (projectId) where.projectId = projectId;
    if (keyword) where.project = { name: { contains: keyword, mode: 'insensitive' } };
    const list = await this.prisma.reviewRecord.findMany({
      where,
      include: { project: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      list: list.map((r) => ({
        projectId: r.projectId,
        projectName: (r.project as { name: string }).name,
        result: r.result,
        reason: r.reason ?? undefined,
        improvements: r.improvements ?? undefined,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
