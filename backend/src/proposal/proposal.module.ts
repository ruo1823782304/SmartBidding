import { Module } from '@nestjs/common';
import { ProposalController } from './proposal.controller';
import { ProposalService } from './proposal.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [ProposalController],
  providers: [ProposalService],
  exports: [ProposalService],
})
export class ProposalModule {}
