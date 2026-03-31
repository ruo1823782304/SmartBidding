import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { RivalService } from './rival.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('rivals')
@UseGuards(JwtAuthGuard)
export class RivalController {
  constructor(private readonly rivalService: RivalService) {}

  @Get()
  async list(@Query('projectId') projectId?: string) {
    return this.rivalService.list(projectId);
  }

  @Post()
  async create(@Body() body: { name: string; price?: string; advantage?: string; weakness?: string; strategy?: string; projectIds?: string[] }) {
    const created = await this.rivalService.create(body);
    return created;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; price?: string; advantage?: string; weakness?: string; strategy?: string; projectIds?: string[] },
  ) {
    return this.rivalService.update(id, body);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.rivalService.delete(id);
  }
}
