import { Module } from '@nestjs/common';
import { SectionAssignmentController } from './section-assignment.controller';
import { SectionAssignmentService } from './section-assignment.service';

@Module({
  controllers: [SectionAssignmentController],
  providers: [SectionAssignmentService],
  exports: [SectionAssignmentService],
})
export class SectionAssignmentModule {}
