import { Injectable } from '@nestjs/common';
import type {
  AntiCheatFlag,
  Attempt,
  AttemptInput,
  AuditEvent,
  Reward,
  RewardGrant,
  User,
  Wallet,
} from '../common/domain.types';

interface IdempotencyRecord {
  requestHash: string;
  response: unknown;
  createdAt: number;
}

@Injectable()
export class InMemoryDatabaseService {
  public readonly users = new Map<string, User>();

  public readonly usersByTelegramId = new Map<string, string>();

  public readonly wallets = new Map<string, Wallet>();

  public readonly attempts = new Map<string, Attempt>();

  public readonly attemptInputs = new Map<string, AttemptInput[]>();

  public readonly rewards = new Map<string, Reward>();

  public readonly rewardsByCode = new Map<string, string>();

  public readonly rewardGrants = new Map<string, RewardGrant>();

  public readonly rewardGrantsByAttemptId = new Map<string, string>();

  public readonly auditEvents: AuditEvent[] = [];

  public readonly antiCheatFlags: AntiCheatFlag[] = [];

  public readonly idempotency = new Map<string, IdempotencyRecord>();

  public auditSequence = 1;

  public antiCheatSequence = 1;
}
