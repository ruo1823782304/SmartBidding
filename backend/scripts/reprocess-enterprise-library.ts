import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LibraryIngestService } from '../src/asset/library-ingest.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const libraryIngestService = app.get(LibraryIngestService);
    const requestedIds = (process.env.INGEST_JOB_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const jobs = await prisma.libraryIngestJob.findMany({
      where: requestedIds.length > 0 ? { id: { in: requestedIds } } : undefined,
      select: {
        id: true,
        sourceFileName: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    for (const job of jobs) {
      console.log(`[reprocess-enterprise-library] start ${job.id} ${job.sourceFileName}`);
      await libraryIngestService.processJob(job.id);
      console.log(`[reprocess-enterprise-library] done ${job.id} ${job.sourceFileName}`);
    }

    console.log(
      JSON.stringify(
        {
          processedJobs: jobs.length,
          requestedIds,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
