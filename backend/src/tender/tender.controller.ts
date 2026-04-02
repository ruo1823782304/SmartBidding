import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { TenderService } from './tender.service';
import { ParseTenderDto } from './dto/parse-tender.dto';
import { GenerateOutlineDto } from './dto/generate-outline.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('tender')
@UseGuards(JwtAuthGuard)
export class TenderController {
  constructor(private readonly tenderService: TenderService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Body('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Tender file is required.');
    }
    return this.tenderService.upload(projectId, file);
  }

  @Post('parse')
  async parse(@Body() dto: ParseTenderDto) {
    return this.tenderService.parse(dto.projectId, dto.fileId);
  }

  @Get('parse/result')
  async getParseResult(@Query('projectId') projectId?: string, @Query('taskId') taskId?: string) {
    return this.tenderService.getParseResult(projectId, taskId);
  }

  @Get('parse/status/:taskId')
  async getParseStatus(@Param('taskId') taskId: string) {
    return this.tenderService.getParseResult(undefined, taskId);
  }

  @Get('parse/items/:itemId/trace')
  async getParseItemTrace(@Param('itemId') itemId: string) {
    return this.tenderService.getParseItemTrace(itemId);
  }

  @Get('documents/:documentVersionId/source-file')
  async getSourceFile(
    @Param('documentVersionId') documentVersionId: string,
    @Res() response: Response,
  ) {
    const sourceFile = await this.tenderService.getSourceFile(documentVersionId);
    response.setHeader('Content-Type', sourceFile.mimeType);
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(sourceFile.fileName)}`);
    response.send(sourceFile.buffer);
  }

  @Post('outline/generate')
  async generateOutline(@Body() dto: GenerateOutlineDto) {
    return this.tenderService.generateOutline(dto.projectId);
  }
}
