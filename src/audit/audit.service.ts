import { Injectable, Logger } from '@nestjs/common';
import { getEnvBool } from '../common/env';
import { InMemoryDatabaseService } from '../storage/in-memory-database.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  private readonly enabled = getEnvBool('AUDIT_LOG_ENABLED', true);

  constructor(private readonly db: InMemoryDatabaseService) {}

  log(
    eventType: string,
    payload: Record<string, unknown>,
    userId?: string,
    attemptId?: string,
  ): void {
    if (!this.enabled) {
      this.logger.debug(`Audit disabled, event skipped eventType=${eventType}`);
      return;
    }

    this.db.auditEvents.push({
      id: this.db.auditSequence++,
      userId: userId ?? null,
      attemptId: attemptId ?? null,
      eventType,
      payload,
      createdAt: Date.now(),
    });
    this.logger.debug(
      `Audit event stored eventType=${eventType} userId=${userId ?? 'n/a'} attemptId=${attemptId ?? 'n/a'}`,
    );
  }
}
