import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ModelProviderDto, ModelConfigDto } from './dto/model-config.dto';
import { ModelProviderConfig } from './settings.types';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('管理员')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('model')
  async getModelConfig() {
    return this.settingsService.getModelConfig();
  }

  @Post('model/coding-plan/parse')
  async parseCodingPlan(@Body('url') url: string, @Body('apiKey') apiKey: string) {
    return this.settingsService.parseCodingPlan(url, apiKey);
  }

  @Post('model/verify')
  async verifyProvider(@Body() dto: ModelProviderDto) {
    return this.settingsService.verifyProvider(dto as unknown as ModelProviderConfig);
  }

  @Put('model')
  async setModelConfig(@Body() dto: ModelConfigDto) {
    return this.settingsService.setModelConfig(dto);
  }
}
