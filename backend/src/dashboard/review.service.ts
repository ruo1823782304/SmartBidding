import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async saveReview(
    projectId: string,
    data: { result: string; reason?: string; improvements?: string; scoreBreakdown?: object },
  ) {
    await this.prisma.reviewRecord.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });
    return { success: true };
  }
}
