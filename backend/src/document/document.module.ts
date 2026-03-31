import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentService } from './document.service';

@Module({
  imports: [PrismaModule],
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentModule {}
