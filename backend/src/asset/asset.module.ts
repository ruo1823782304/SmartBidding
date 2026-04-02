import { Module } from '@nestjs/common';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { DocumentModule } from '../document/document.module';
import { QueueModule } from '../queue/queue.module';
import { RagModule } from '../rag/rag.module';
import { AiModule } from '../ai/ai.module';
import { LibraryIngestService } from './library-ingest.service';
import { LibraryIngestWorker } from './workers/library-ingest.worker';

@Module({
  imports: [PrismaModule, StorageModule, DocumentModule, QueueModule, RagModule, AiModule],
  controllers: [AssetController],
  providers: [AssetService, LibraryIngestService, LibraryIngestWorker],
})
export class AssetModule {}
