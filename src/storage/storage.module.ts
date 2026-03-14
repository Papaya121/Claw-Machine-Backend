import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency.service';
import { InMemoryDatabaseService } from './in-memory-database.service';

@Global()
@Module({
  providers: [InMemoryDatabaseService, IdempotencyService],
  exports: [InMemoryDatabaseService, IdempotencyService],
})
export class StorageModule {}
