import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

function installProcessDiagnostics() {
  process.on('uncaughtException', (error) => {
    console.error('[fatal] uncaughtException', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandledRejection', reason);
  });

  process.on('SIGINT', () => {
    console.warn('[lifecycle] received SIGINT');
  });

  process.on('SIGTERM', () => {
    console.warn('[lifecycle] received SIGTERM');
  });

  process.on('beforeExit', (code) => {
    console.warn(`[lifecycle] beforeExit with code ${code}`);
  });

  process.on('exit', (code) => {
    console.warn(`[lifecycle] process exit with code ${code}`);
  });
}

async function bootstrap() {
  installProcessDiagnostics();
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '150mb' }));
  app.use(urlencoded({ extended: true, limit: '150mb' }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Backend running at http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
