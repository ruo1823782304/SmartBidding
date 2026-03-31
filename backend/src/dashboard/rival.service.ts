import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RivalService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId?: string) {
    const where = projectId ? { projects: { some: { projectId } } } : {};
    const rivals = await this.prisma.rival.findMany({
      where,
      include: { projects: true },
    });
    return {
      list: rivals.map((r) => ({
        id: r.id,
        name: r.name,
        price: r.price ?? undefined,
        advantage: r.advantage ?? undefined,
        weakness: r.weakness ?? undefined,
        strategy: r.strategy ?? undefined,
        projectIds: r.projects.map((p) => p.projectId),
      })),
    };
  }

  async create(data: { name: string; price?: string; advantage?: string; weakness?: string; strategy?: string; projectIds?: string[] }) {
    const { projectIds, ...rest } = data;
    const rival = await this.prisma.rival.create({ data: rest });
    if (projectIds?.length) {
      await this.prisma.rivalProject.createMany({
        data: projectIds.map((projectId) => ({ rivalId: rival.id, projectId })),
        skipDuplicates: true,
      });
    }
    const full = await this.prisma.rival.findUniqueOrThrow({
      where: { id: rival.id },
      include: { projects: true },
    });
    return {
      id: full.id,
      name: full.name,
      price: full.price ?? undefined,
      advantage: full.advantage ?? undefined,
      weakness: full.weakness ?? undefined,
      strategy: full.strategy ?? undefined,
      projectIds: full.projects.map((p) => p.projectId),
    };
  }

  async update(
    id: string,
    data: { name?: string; price?: string; advantage?: string; weakness?: string; strategy?: string; projectIds?: string[] },
  ) {
    const { projectIds, ...rest } = data;
    await this.prisma.rival.update({ where: { id }, data: rest });
    if (projectIds !== undefined) {
      await this.prisma.rivalProject.deleteMany({ where: { rivalId: id } });
      if (projectIds.length) {
        await this.prisma.rivalProject.createMany({
          data: projectIds.map((projectId) => ({ rivalId: id, projectId })),
          skipDuplicates: true,
        });
      }
    }
    return { success: true };
  }

  async delete(id: string) {
    await this.prisma.rival.delete({ where: { id } });
    return { success: true };
  }
}
