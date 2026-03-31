import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { SectionAssignmentService } from './section-assignment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class SectionAssignmentController {
  constructor(private readonly service: SectionAssignmentService) {}

  @Get(':projectId/section-assignments')
  async get(@Param('projectId') projectId: string) {
    return this.service.get(projectId);
  }

  @Put(':projectId/section-assignments')
  async set(
    @Param('projectId') projectId: string,
    @Body() body: { assignments: Record<string, string[]> },
  ) {
    return this.service.set(projectId, body.assignments ?? {});
  }
}
