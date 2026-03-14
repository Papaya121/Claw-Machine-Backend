import { Injectable } from '@nestjs/common';
import { InMemoryDatabaseService } from '../storage/in-memory-database.service';

@Injectable()
export class AdminService {
  constructor(private readonly db: InMemoryDatabaseService) {}

  metrics() {
    const attempts = [...this.db.attempts.values()];
    const wins = attempts.filter((attempt) => attempt.result === 'win').length;

    return {
      users: this.db.users.size,
      attempts: attempts.length,
      wins,
      winRate: attempts.length
        ? Number((wins / attempts.length).toFixed(4))
        : 0,
      antiCheatFlags: this.db.antiCheatFlags.length,
      auditEvents: this.db.auditEvents.length,
    };
  }

  listRewards() {
    return [...this.db.rewards.values()];
  }
}
