import { Module } from '@nestjs/common';
import { DoclingAdapterService } from './docling-adapter.service';
import { RagService } from './rag.service';

@Module({
  providers: [DoclingAdapterService, RagService],
  exports: [DoclingAdapterService, RagService],
})
export class RagModule {}
