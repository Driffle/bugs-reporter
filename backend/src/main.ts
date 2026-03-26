import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { LoggerService } from './logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const logger = app.get(LoggerService);
  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`Bugs Reporter backend listening on port ${port}`, 'Bootstrap');
  logger.log(`Slack Events URL: http://localhost:${port}/slack/events`, 'Bootstrap');
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
