import { Module } from '@nestjs/common';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { SectionAssignmentModule } from '../section-assignment/section-assignment.module';

@Module({
  imports: [SectionAssignmentModule],
  controllers: [TaskController],
  providers: [TaskService],
})
export class TaskModule {}
