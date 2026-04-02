import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { OutlineDto } from './dto/outline.dto';
import { normalizeOutlineGroups } from '../proposal/proposal-outline.util';

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  private toProject(p: { id: string; name: string; owner: string | null; deadline: string | null; progress: string | null; type: string | null }) {
    return {
      id: p.id,
      name: p.name,
      owner: p.owner ?? '',
      deadline: p.deadline ?? '',
      progress: p.progress ?? '',
      type: p.type ?? '',
    };
  }

  async getBoard(type?: string) {
    const where = type ? { type } : {};
    const all = await this.prisma.project.findMany({
      where: { archivedAt: null, ...where },
      select: { id: true, name: true, owner: true, deadline: true, progress: true, type: true, status: true },
    });
    const pending = all.filter((p) => p.status === 'pending').map(this.toProject);
    const ongoing = all.filter((p) => p.status === 'ongoing').map(this.toProject);
    const review = all.filter((p) => p.status === 'review').map(this.toProject);
    const done = all.filter((p) => p.status === 'done').map(this.toProject);
    return { pending, ongoing, review, done };
  }

  async create(dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        owner: dto.owner,
        deadline: dto.deadline,
        type: dto.type,
      },
    });
    return { success: true, project: this.toProject(project) };
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    await this.prisma.project.update({
      where: { id },
      data: { status: dto.status },
    });
    return { success: true };
  }

  async archive(id: string) {
    const project = await this.prisma.project.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return { success: true, archivedAt: project.archivedAt?.toISOString() };
  }

  async getArchived() {
    const list = await this.prisma.project.findMany({
      where: { archivedAt: { not: null } },
      select: { id: true, name: true, status: true, archivedAt: true },
    });
    return {
      list: list.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        archivedAt: p.archivedAt?.toISOString() ?? '',
      })),
    };
  }

  async getOutline(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { tenderOutline: true, techOutlineSections: true, bizOutlineSections: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    return {
      tenderOutline: project.tenderOutline ?? undefined,
      techOutlineSections: normalizeOutlineGroups(project.techOutlineSections),
      bizOutlineSections: normalizeOutlineGroups(project.bizOutlineSections),
    };
  }

  async updateOutline(projectId: string, dto: OutlineDto) {
    const techOutlineSections =
      dto.techOutlineSections !== undefined ? normalizeOutlineGroups(dto.techOutlineSections) : undefined;
    const bizOutlineSections =
      dto.bizOutlineSections !== undefined ? normalizeOutlineGroups(dto.bizOutlineSections) : undefined;

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.tenderOutline !== undefined && { tenderOutline: dto.tenderOutline }),
        ...(techOutlineSections !== undefined && { techOutlineSections: techOutlineSections as object }),
        ...(bizOutlineSections !== undefined && { bizOutlineSections: bizOutlineSections as object }),
      },
    });
    return { success: true };
  }
}
