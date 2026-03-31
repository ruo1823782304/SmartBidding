import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
