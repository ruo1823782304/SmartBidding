import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SectionAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async get(projectId: string) {
    const list = await this.prisma.sectionAssignment.findMany({
      where: { projectId },
    });
    const assignments: Record<string, string[]> = {};
    for (const a of list) {
      if (!assignments[a.sectionKey]) assignments[a.sectionKey] = [];
      if (!assignments[a.sectionKey].includes(a.username)) assignments[a.sectionKey].push(a.username);
    }
    return { assignments };
  }

  async set(projectId: string, assignments: Record<string, string[]>) {
    await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.prisma.sectionAssignment.deleteMany({ where: { projectId } });
    const rows: { projectId: string; sectionKey: string; username: string }[] = [];
    for (const [sectionKey, usernames] of Object.entries(assignments || {})) {
      const unique = [...new Set(Array.isArray(usernames) ? usernames : [])];
      for (const username of unique) {
        if (username) rows.push({ projectId, sectionKey, username });
      }
    }
    if (rows.length) {
      await this.prisma.sectionAssignment.createMany({ data: rows });
    }
    return { success: true };
  }
}
