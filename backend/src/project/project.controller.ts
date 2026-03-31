import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { OutlineDto } from './dto/outline.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get('board')
  async getBoard(@Query('type') type?: string) {
    return this.projectService.getBoard(type);
  }

  @Post()
  async create(@Body() dto: CreateProjectDto) {
    return this.projectService.create(dto);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.projectService.updateStatus(id, dto);
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string) {
    return this.projectService.archive(id);
  }

  @Get('archived')
  async getArchived() {
    return this.projectService.getArchived();
  }

  @Get(':projectId/outline')
  async getOutline(@Param('projectId') projectId: string) {
    return this.projectService.getOutline(projectId);
  }

  @Put(':projectId/outline')
  async updateOutline(@Param('projectId') projectId: string, @Body() dto: OutlineDto) {
    return this.projectService.updateOutline(projectId, dto);
  }
}
