import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { AdminModule } from './admin/admin.module';
import { SettingsModule } from './settings/settings.module';
import { ProjectModule } from './project/project.module';
import { AiModule } from './ai/ai.module';
import { TenderModule } from './tender/tender.module';
import { ProposalModule } from './proposal/proposal.module';
import { SectionAssignmentModule } from './section-assignment/section-assignment.module';
import { TaskModule } from './task/task.module';
import { AssetModule } from './asset/asset.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { DocumentModule } from './document/document.module';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UserModule,
    AdminModule,
    SettingsModule,
    ProjectModule,
    AiModule,
    TenderModule,
    ProposalModule,
    SectionAssignmentModule,
    TaskModule,
    AssetModule,
    DashboardModule,
    StorageModule,
    QueueModule,
    DocumentModule,
    RagModule,
  ],
})
export class AppModule {}
