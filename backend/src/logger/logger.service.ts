import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino from 'pino';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
      base: { service: 'bugs-reporter' },
    });
  }

  log(messageOrObj: string | Record<string, unknown>, message?: string) {
    typeof messageOrObj === 'object'
      ? this.logger.info(messageOrObj, message!)
      : this.logger.info(messageOrObj);
  }

  error(messageOrObj: string | Record<string, unknown>, trace?: string, context?: string) {
    typeof messageOrObj === 'object'
      ? this.logger.error(messageOrObj, trace)
      : this.logger.error({ context, trace }, messageOrObj);
  }

  warn(messageOrObj: string | Record<string, unknown>, message?: string) {
    typeof messageOrObj === 'object'
      ? this.logger.warn(messageOrObj, message!)
      : this.logger.warn(messageOrObj);
  }

  debug(messageOrObj: string | Record<string, unknown>, message?: string) {
    typeof messageOrObj === 'object'
      ? this.logger.debug(messageOrObj, message!)
      : this.logger.debug(messageOrObj);
  }

  verbose(messageOrObj: string | Record<string, unknown>, message?: string) {
    typeof messageOrObj === 'object'
      ? this.logger.trace(messageOrObj, message!)
      : this.logger.trace(messageOrObj);
  }

  child(bindings: Record<string, unknown>): pino.Logger {
    return this.logger.child(bindings);
  }
}
