import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssignTaskDto } from './dto/assign-task.dto';
import { SectionAssignmentService } from '../section-assignment/section-assignment.service';

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sectionAssignment: SectionAssignmentService,
  ) {}

  async getTasks(projectId: string, status?: string, myOnly?: boolean, currentUsername?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          include: { assignments: true, history: { orderBy: { at: 'desc' }, take: 20 } },
        },
      },
    });
    if (!project) throw new NotFoundException('项目不存在');
    let tasks = project.tasks;
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (myOnly && currentUsername) {
      tasks = tasks.filter((t) => t.assignments.some((a) => a.username === currentUsername));
    }
    const list = tasks.map((t) => ({
      id: t.id,
      name: t.name,
      projectName: project.name,
      taskType: t.taskType,
      requirement: t.requirement ?? '',
      createdAt: t.createdAt.toISOString(),
      urgency: t.urgency ?? '中',
      sectionKey: t.sectionKey ?? '',
      status: t.status,
      assignments: t.assignments.map((a) => ({
        userName: a.username,
        department: '—',
        roleName: a.roleName ?? '—',
        assignedAt: a.assignedAt.toISOString(),
        progress: a.progress ?? '0%',
      })),
      history: t.history.map((h) => ({
        at: h.at.toISOString(),
        status: h.status,
        note: h.note ?? '',
        operator: h.operator,
      })),
    }));
    return { list };
  }

  async assign(taskId: string, dto: AssignTaskDto, operator: string) {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { project: true },
    });
    await this.prisma.taskAssignment.upsert({
      where: { taskId_username: { taskId, username: dto.username } },
      create: {
        taskId,
        username: dto.username,
        roleName: dto.roleName,
      },
      update: { roleName: dto.roleName },
    });
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: '进行中' },
    });
    await this.prisma.taskHistory.create({
      data: { taskId, status: '已分配', note: `分配给 ${dto.username}`, operator },
    });
    if (task.taskType === '标书制作人员分配' && dto.sectionKeys?.length) {
      const current = await this.sectionAssignment.get(task.projectId);
      const next = { ...current.assignments };
      for (const key of dto.sectionKeys) {
        next[key] = [...(next[key] || []).filter((u) => u !== dto.username), dto.username];
      }
      await this.sectionAssignment.set(task.projectId, next);
    }
    return { success: true };
  }

  async approve(taskId: string, comment: string | undefined, operator: string) {
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: '已完成' },
    });
    await this.prisma.taskHistory.create({
      data: { taskId, status: '通过', note: comment ?? '', operator },
    });
    return { success: true };
  }

  async reject(taskId: string, reason: string, operator: string) {
    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: '已驳回' },
    });
    await this.prisma.taskHistory.create({
      data: { taskId, status: '驳回', note: reason, operator },
    });
    return { success: true };
  }

  async getApprovals(projectId: string) {
    const history = await this.prisma.taskHistory.findMany({
      where: { task: { projectId }, status: { in: ['通过', '驳回'] } },
      include: { task: true },
      orderBy: { at: 'desc' },
    });
    const list = history.map((h) => ({
      taskId: h.taskId,
      operator: h.operator,
      action: h.status === '通过' ? '通过' as const : '驳回' as const,
      comment: h.note ?? undefined,
      at: h.at.toISOString(),
    }));
    return { list };
  }
}
