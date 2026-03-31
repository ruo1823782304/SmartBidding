import { Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetService } from './asset.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Get()
  async list(
    @Query('category') category?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.assetService.list(category, keyword, p, ps);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(
    @Body('category') category: string,
    @Body('title') title: string,
    @Body('content') content: string | undefined,
    @Body('tags') tagsStr: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const tags = tagsStr ? (typeof tagsStr === 'string' ? JSON.parse(tagsStr) : tagsStr) : undefined;
    const fileUrl = file ? `/uploads/assets/${file.filename || file.originalname}` : undefined;
    return this.assetService.create(category, title ?? '', user.username, fileUrl, content, tags);
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
