import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { ModelConfigDto } from './dto/model-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('管理员')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('model')
  async getModelConfig() {
    return this.settingsService.getModelConfig();
  }

  @Put('model')
  async setModelConfig(@Body() dto: ModelConfigDto) {
    return this.settingsService.setModelConfig(dto as Record<string, string | undefined>);
  }
}
