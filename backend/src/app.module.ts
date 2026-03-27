import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { LoggerModule } from './logger/logger.module';
import { SlackModule } from './slack/slack.module';
import { PlaneModule } from './plane/plane.module';
import { DeduplicationModule } from './deduplication/deduplication.module';
import { AiModule } from './ai/ai.module';
import { TicketProcessor } from './jobs/ticket.processor';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    BullModule.forRootAsync({
      useFactory: () => {
        // ACL users often cannot run INFO. enableReadyCheck=false skips ioredis INFO; skipVersionCheck skips
        // BullMQ's probe. Connection must include skipVersionCheck: Nest does not pass top-level queue opts into Worker.
        const redisOpts = {
          maxRetriesPerRequest: null,
          lazyConnect: true,
          connectTimeout: 10000,
          enableReadyCheck: false,
          skipVersionCheck: true,
          retryStrategy: (times: number) => Math.min(times * 300, 3000),
        };
        const shared = { skipVersionCheck: true as const };
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
          return { connection: { url: redisUrl, ...redisOpts }, ...shared };
        }
        return {
          connection: {
            host: process.env.REDIS_HOST ?? 'localhost',
            port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            password: process.env.REDIS_PASSWORD ?? undefined,
            ...redisOpts,
          },
          ...shared,
        };
      },
    }),
    BullModule.registerQueue({
      name: 'ticket',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 500 },
      },
    }),
    PrismaModule,
    LoggerModule,
    SlackModule,
    PlaneModule,
    DeduplicationModule,
    AiModule,
    HealthModule,
  ],
  providers: [TicketProcessor],
})
export class AppModule {}
