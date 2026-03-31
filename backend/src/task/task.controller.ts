import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TaskService } from './task.service';
import { AssignTaskDto } from './dto/assign-task.dto';
import { ApproveDto } from './dto/approve.dto';
import { RejectDto } from './dto/reject.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get('projects/:projectId/tasks')
  async getTasks(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('myOnly') myOnly?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return this.taskService.getTasks(projectId, status, myOnly === 'true' || myOnly === '1', user?.username);
  }

  @Get('tasks')
  async getTasksByQuery(
    @Query('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('myOnly') myOnly?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    if (!projectId) return { list: [] };
    return this.taskService.getTasks(projectId, status, myOnly === 'true' || myOnly === '1', user?.username);
  }

  @Post('tasks/:taskId/assign')
  async assign(
    @Param('taskId') taskId: string,
    @Body() dto: AssignTaskDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.taskService.assign(taskId, dto, user.username);
  }

  @Post('tasks/:taskId/approve')
  async approve(
    @Param('taskId') taskId: string,
    @Body() dto: ApproveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.taskService.approve(taskId, dto.comment, user.username);
  }

  @Post('tasks/:taskId/reject')
  async reject(
    @Param('taskId') taskId: string,
    @Body() dto: RejectDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.taskService.reject(taskId, dto.reason, user.username);
  }

  @Get('projects/:projectId/approvals')
  async getApprovals(@Param('projectId') projectId: string) {
    return this.taskService.getApprovals(projectId);
  }
}
