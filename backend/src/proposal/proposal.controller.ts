import { Body, Controller, Get, Param, Post, Put, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ProposalService } from './proposal.service';
import { SectionContentDto } from './dto/section-content.dto';
import { SectionCompleteDto } from './dto/section-complete.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProposalController {
  constructor(private readonly proposalService: ProposalService) {}

  @Get(':projectId/sections')
  async listSections(@Param('projectId') projectId: string) {
    return this.proposalService.listSections(projectId);
  }

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
    @Query('title') title?: string,
  ) {
    return this.proposalService.getRecommendations(projectId, decodeURIComponent(sectionKey), title);
  }

  @Get(':projectId/compliance/recommendations')
  async getComplianceRecommendations(@Param('projectId') projectId: string) {
    return this.proposalService.getComplianceRecommendations(projectId);
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
    @Query('kind') kind: 'tech' | 'biz' = 'tech',
  ) {
    return this.proposalService.exportDoc(projectId, format, kind);
  }

  @Post(':projectId/proposal/export')
  async exportPost(
    @Param('projectId') projectId: string,
    @Body() body: { format?: 'word' | 'pdf'; kind?: 'tech' | 'biz' },
  ) {
    return this.proposalService.exportDoc(projectId, body?.format || 'word', body?.kind || 'tech');
  }

  @Get(':projectId/proposal/export/file')
  async exportFile(
    @Param('projectId') projectId: string,
    @Query('format') format: 'word' | 'pdf' = 'word',
    @Query('kind') kind: 'tech' | 'biz' = 'tech',
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.proposalService.exportDocFile(projectId, format, kind);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }

  @Post(':projectId/sections/:sectionKey/generate')
  async generateSection(
    @Param('projectId') projectId: string,
    @Param('sectionKey') sectionKey: string,
    @Body()
    body: {
      context?: string;
      currentContent?: string;
      sectionTitle?: string;
      sectionDetail?: string;
      outlinePath?: string;
      bidKind?: 'tech' | 'biz';
      assetIds?: string[];
      sourceItemIds?: string[];
      boundRequirementText?: string;
      customPrompt?: string;
    },
  ) {
    const content = await this.proposalService.generateSectionContent(
      projectId,
      decodeURIComponent(sectionKey),
      body,
    );
    return { content };
  }
}
