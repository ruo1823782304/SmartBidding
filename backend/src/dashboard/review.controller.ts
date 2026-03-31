import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ReviewService } from './review.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly reviewService: ReviewService,
  ) {}

  @Get('knowledge/review')
  async getReviewList(@Query('projectId') projectId?: string, @Query('keyword') keyword?: string) {
    return this.dashboardService.getReviewList(projectId, keyword);
  }

  @Get('projects/review-records')
  async getReviewRecords(@Query('projectId') projectId?: string, @Query('keyword') keyword?: string) {
    return this.dashboardService.getReviewList(projectId, keyword);
  }

  @Put('projects/:projectId/review')
  async saveReview(
    @Param('projectId') projectId: string,
    @Body() body: { result: string; reason?: string; improvements?: string; scoreBreakdown?: object },
  ) {
    return this.reviewService.saveReview(projectId, body);
  }
}
