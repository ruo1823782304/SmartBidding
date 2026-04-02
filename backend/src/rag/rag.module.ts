import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DoclingAdapterService } from './docling-adapter.service';
import { RagService } from './rag.service';

@Module({
  imports: [AiModule],
  providers: [DoclingAdapterService, RagService],
  exports: [DoclingAdapterService, RagService],
})
export class RagModule {}
