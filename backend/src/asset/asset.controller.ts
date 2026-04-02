import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetService } from './asset.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { LibraryIngestService } from './library-ingest.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { ConfirmIngestItemDto } from './dto/confirm-ingest-item.dto';
import type { Response } from 'express';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetController {
  constructor(
    private readonly assetService: AssetService,
    private readonly libraryIngestService: LibraryIngestService,
  ) {}

  @Get()
  async list(
    @Query('category') category?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('subtype') subtype?: string,
    @Query('sourceMode') sourceMode?: string,
    @Query('jobId') jobId?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.assetService.list(category, keyword, p, ps, {
      subtype,
      sourceMode,
      jobId,
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @Body()
    body: CreateAssetDto & {
      tags?: string[] | string;
      subtype?: string;
      sourceMode?: string;
      metadata?: string | Record<string, unknown>;
    },
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const tags = body.tags
      ? typeof body.tags === 'string'
        ? JSON.parse(body.tags)
        : body.tags
      : undefined;
    const metadata =
      typeof body.metadata === 'string'
        ? JSON.parse(body.metadata)
        : body.metadata;
    return this.assetService.create(
      body.category,
      body.title ?? '',
      user.username,
      file,
      body.content,
      tags,
      {
        subtype: body.subtype,
        sourceMode: body.sourceMode,
        metadata,
      },
    );
  }

  @Post('ingest/jobs')
  @UseInterceptors(FileInterceptor('file'))
  async createIngestJob(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.libraryIngestService.createJob(file, user.username);
  }

  @Get('ingest/jobs')
  async listIngestJobs() {
    return this.libraryIngestService.listJobs();
  }

  @Get('ingest/jobs/:id')
  async getIngestJob(@Param('id') id: string) {
    return this.libraryIngestService.getJob(id);
  }

  @Delete('ingest/jobs/:id')
  async deleteIngestJob(@Param('id') id: string) {
    return this.libraryIngestService.deleteJob(id);
  }

  @Post('ingest/jobs/:id/finalize')
  async finalizeIngestJob(@Param('id') id: string) {
    return this.libraryIngestService.finalizeJob(id);
  }

  @Post('ingest/items/:id/confirm')
  async confirmIngestItem(
    @Param('id') id: string,
    @Body() body: ConfirmIngestItemDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.libraryIngestService.confirmItem(id, body, user.username);
  }

  @Delete('ingest/items/:id')
  async deleteIngestItem(@Param('id') id: string) {
    return this.libraryIngestService.deleteItem(id);
  }

  @Get(':id/download')
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.assetService.downloadAsset(id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: string; tags?: string[]; content?: string },
  ) {
    return this.assetService.update(id, body);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.assetService.delete(id);
  }

  @Post('archive/batch-classify')
  @UseInterceptors(FileInterceptor('file'))
  async batchClassify(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.assetService.batchClassify(file ? [file] : []);
  }
}
