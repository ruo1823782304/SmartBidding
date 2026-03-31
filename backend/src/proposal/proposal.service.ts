import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async getSectionContent(projectId: string, sectionKey: string) {
    const section = await this.prisma.sectionContent.findUnique({
      where: { projectId_sectionKey: { projectId, sectionKey } },
    });
    if (!section)
      return {
        content: '',
        version: 0,
        lastEditedAt: undefined,
        lastEditedBy: undefined,
      };
    return {
      content: section.content,
      version: section.version,
      lastEditedAt: section.lastEditedAt?.toISOString(),
      lastEditedBy: section.lastEditedBy ?? undefined,
    };
  }

  async saveSectionContent(projectId: string, sectionKey: string, content: string, lastEditedBy?: string) {
    const updated = await this.prisma.sectionContent.upsert({
      where: { projectId_sectionKey: { projectId, sectionKey } },
      create: {
        projectId,
        sectionKey,
        content,
        lastEditedBy,
        lastEditedAt: new Date(),
      },
      update: {
        content,
        version: { increment: 1 },
        lastEditedBy,
        lastEditedAt: new Date(),
      },
    });
    return { success: true, version: updated.version };
  }

  async setSectionComplete(projectId: string, sectionKey: string, completed: boolean) {
    await this.prisma.sectionContent.upsert({
      where: { projectId_sectionKey: { projectId, sectionKey } },
      create: { projectId, sectionKey, content: '', completed },
      update: { completed },
    });
    return { success: true };
  }

  async getRecommendations(projectId: string, sectionKey: string) {
    const assets = await this.prisma.asset.findMany({
      take: 10,
      select: { id: true, title: true, category: true, snippet: true },
    });
    return {
      list: assets.map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category,
        snippet: a.snippet ?? undefined,
      })),
    };
  }

  async submit(projectId: string, _comment?: string) {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { proposalStatus: '待初审' },
    });
    const task = await this.prisma.task.findFirst({
      where: { projectId, taskType: '标书审核任务' },
    });
    if (task) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: '进行中' },
      });
    }
    return { success: true };
  }

  async exportDoc(projectId: string, format: 'word' | 'pdf') {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { sections: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    const title = `${project.name}_标书`;
    if (format === 'word') {
      return { success: true, downloadUrl: `/api/projects/${projectId}/proposal/export/file?format=word`, filename: `${title}.docx` };
    }
    return { success: true, downloadUrl: `/api/projects/${projectId}/proposal/export/file?format=pdf`, filename: `${title}.pdf` };
  }

  async generateSectionContent(projectId: string, sectionKey: string, context?: string): Promise<string> {
    const name = sectionKey.includes('::') ? sectionKey.split('::').pop()! : sectionKey;
    return this.ai.generateSectionContent(name, context);
  }
}
