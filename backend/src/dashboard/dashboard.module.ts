import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { ReviewController } from './review.controller';
import { RivalController } from './rival.controller';
import { DashboardService } from './dashboard.service';
import { ReviewService } from './review.service';
import { RivalService } from './rival.service';

@Module({
  controllers: [DashboardController, ReviewController, RivalController],
  providers: [DashboardService, ReviewService, RivalService],
})
export class DashboardModule {}
