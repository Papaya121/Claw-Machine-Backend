import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID().slice(0, 8);
    const startedAt = Date.now();

    logger.log(
      `[${requestId}] ${req.method} ${req.originalUrl} ip=${req.ip ?? 'unknown'}`,
    );

    res.on('finish', () => {
      const elapsedMs = Date.now() - startedAt;
      logger.log(
        `[${requestId}] ${req.method} ${req.originalUrl} status=${res.statusCode} durationMs=${elapsedMs}`,
      );
    });

    next();
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Server listening on port ${port}`);
}

void bootstrap();
