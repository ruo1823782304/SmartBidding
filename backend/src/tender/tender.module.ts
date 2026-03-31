import { Module } from '@nestjs/common';
import { TenderController } from './tender.controller';
import { TenderService } from './tender.service';
import { AiModule } from '../ai/ai.module';
import { ProjectModule } from '../project/project.module';
import { DocumentModule } from '../document/document.module';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { RagModule } from '../rag/rag.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenderParseWorker } from './workers/tender-parse.worker';

@Module({
  imports: [AiModule, ProjectModule, PrismaModule, DocumentModule, StorageModule, QueueModule, RagModule],
  controllers: [TenderController],
  providers: [TenderService, TenderParseWorker],
})
export class TenderModule {}
