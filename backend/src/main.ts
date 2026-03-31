import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
