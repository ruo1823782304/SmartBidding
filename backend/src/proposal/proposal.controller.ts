import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ProposalService } from './proposal.service';
import { SectionContentDto } from './dto/section-content.dto';
import { SectionCompleteDto } from './dto/section-complete.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProposalController {
  constructor(private readonly proposalService: ProposalService) {}

  @Get(':projectId/sections/:sectionKey/content')
  async getSectionContent(
    @Param('projectId') projectId: string,
    @Param('sectionKey') sectionKey: string,
  ) {
    return this.proposalService.getSectionContent(projectId, decodeURIComponent(sectionKey));
  }

  @Put(':projectId/sections/:sectionKey/content')
  async saveSectionContent(
    @Param('projectId') projectId: string,
    @Param('sectionKey') sectionKey: string,
    @Body() dto: SectionContentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.proposalService.saveSectionContent(
      projectId,
      decodeURIComponent(sectionKey),
      dto.content,
      user.username,
    );
  }

  @Post(':projectId/sections/:sectionKey/complete')
  async setSectionComplete(
    @Param('projectId') projectId: string,
    @Param('sectionKey') sectionKey: string,
    @Body() dto: SectionCompleteDto,
  ) {
    return this.proposalService.setSectionComplete(projectId, decodeURIComponent(sectionKey), dto.completed);
  }

  @Get(':projectId/sections/:sectionKey/recommendations')
  async getRecommendations(
    @Param('projectId') projectId: string,
    @Param('sectionKey') sectionKey: string,
  ) {
    return this.proposalService.getRecommendations(projectId, decodeURIComponent(sectionKey));
  }

  @Post(':projectId/proposal/submit')
  async submit(
    @Param('projectId') projectId: string,
    @Body() body: { comment?: string },
  ) {
    return this.proposalService.submit(projectId, body?.comment);
  }

  @Get(':projectId/proposal/export')
  async export(
    @Param('projectId') projectId: string,
    @Query('format') format: 'word' | 'pdf' = 'word',
  ) {
    return this.proposalService.exportDoc(projectId, format);
  }

  @Post(':projectId/proposal/export')
  async exportPost(
    @Param('projectId') projectId: string,
    @Body() body: { format?: 'word' | 'pdf' },
  ) {
    return this.proposalService.exportDoc(projectId, body?.format || 'word');
  }

  @Post(':projectId/sections/:sectionKey/generate')
  async generateSection(
    @Param('projectId') projectId: string,
    @Param('sectionKey') sectionKey: string,
    @Body() body: { context?: string },
  ) {
    const content = await this.proposalService.generateSectionContent(
      projectId,
      decodeURIComponent(sectionKey),
      body?.context,
    );
    return { content };
  }
}
