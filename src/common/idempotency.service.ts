import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InMemoryDatabaseService } from '../storage/in-memory-database.service';
import { sha256Hex } from './crypto.util';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly db: InMemoryDatabaseService) {}

  async run<T>(
    namespace: string,
    idempotencyKey: string,
    requestPayload: unknown,
    handler: () => T | Promise<T>,
  ): Promise<T> {
    if (!idempotencyKey) {
      this.logger.warn(`Missing idempotency key for namespace=${namespace}`);
      throw new ConflictException('Idempotency-Key header is required');
    }

    const recordKey = `${namespace}:${idempotencyKey}`;
    const requestHash = sha256Hex(stableStringify(requestPayload));
    const existing = this.db.idempotency.get(recordKey);
    this.logger.debug(
      `Idempotency check namespace=${namespace} key=${idempotencyKey}`,
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        this.logger.warn(
          `Idempotency conflict namespace=${namespace} key=${idempotencyKey}`,
        );
        throw new ConflictException(
          'Idempotency-Key reused with a different payload',
        );
      }
      this.logger.debug(
        `Idempotency hit namespace=${namespace} key=${idempotencyKey}`,
      );
      return existing.response as T;
    }

    const response = await Promise.resolve(handler());

    if (this.db.idempotency.has(recordKey)) {
      // The same request got resolved in parallel.
      const winner = this.db.idempotency.get(recordKey);
      if (!winner) {
        this.logger.error(
          `Idempotency winner is missing namespace=${namespace} key=${idempotencyKey}`,
        );
        throw new InternalServerErrorException(
          'Idempotency state is inconsistent',
        );
      }
      if (winner.requestHash !== requestHash) {
        this.logger.warn(
          `Concurrent idempotency conflict namespace=${namespace} key=${idempotencyKey}`,
        );
        throw new ConflictException(
          'Idempotency conflict after concurrent request',
        );
      }
      this.logger.debug(
        `Idempotency concurrent winner used namespace=${namespace} key=${idempotencyKey}`,
      );
      return winner.response as T;
    }

    this.db.idempotency.set(recordKey, {
      requestHash,
      response,
      createdAt: Date.now(),
    });
    this.logger.debug(
      `Idempotency stored namespace=${namespace} key=${idempotencyKey}`,
    );

    return response;
  }
}
