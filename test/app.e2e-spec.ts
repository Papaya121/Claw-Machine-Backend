import { Test, TestingModule } from '@nestjs/testing';
import { createHmac, randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { AttemptService } from '../src/attempt/attempt.service';
import { AuthService } from '../src/auth/auth.service';
import type { Attempt, AuthUserContext } from '../src/common/domain.types';
import { InMemoryDatabaseService } from '../src/storage/in-memory-database.service';
import { RewardService } from '../src/reward/reward.service';

function telegramSecret(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

function buildInitData(userId: string, botToken: string): string {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const userJson = JSON.stringify({ id: userId, first_name: 'Tester' });

  const values: Array<[string, string]> = [
    ['auth_date', authDate],
    ['query_id', `query-${userId}`],
    ['user', userJson],
  ];

  const dataCheck = values
    .map(([key, value]) => `${key}=${value}`)
    .sort((a, b) => a.localeCompare(b))
    .join('\n');

  const hash = createHmac('sha256', telegramSecret(botToken))
    .update(dataCheck)
    .digest('hex');

  const params = new URLSearchParams();
  for (const [key, value] of values) {
    params.set(key, value);
  }
  params.set('hash', hash);

  return params.toString();
}

describe('Claw Backend integration', () => {
  let authService: AuthService;
  let attemptService: AttemptService;
  let rewardService: RewardService;
  let db: InMemoryDatabaseService;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt';
    process.env.ATTEMPT_TOKEN_SECRET = 'test-attempt';
    process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
    process.env.DEFAULT_TICKETS = '5';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    authService = moduleFixture.get(AuthService);
    attemptService = moduleFixture.get(AttemptService);
    rewardService = moduleFixture.get(RewardService);
    db = moduleFixture.get(InMemoryDatabaseService);
  });

  function auth(userId: string): AuthUserContext {
    const response = authService.authenticateTelegram(
      buildInitData(userId, process.env.TELEGRAM_BOT_TOKEN || ''),
    );

    return {
      id: response.user.id,
      telegramUserId: response.user.telegramUserId,
    };
  }

  it('start attempt debits ticket exactly once with same idempotency key', async () => {
    const user = auth('1001');
    const idemKey = randomUUID();

    const first = await attemptService.startAttempt(user, idemKey, {
      machineId: 'machine-a',
      clientBuild: '1.0.0',
      configVersion: 'v1-default',
    });

    const second = await attemptService.startAttempt(user, idemKey, {
      machineId: 'machine-a',
      clientBuild: '1.0.0',
      configVersion: 'v1-default',
    });

    expect(first.attemptId).toBe(second.attemptId);
    expect(first.economySnapshot.ticketsLeft).toBe(4);
    expect(second.economySnapshot.ticketsLeft).toBe(4);
  });

  it('duplicate input seq is ignored', async () => {
    const user = auth('1002');
    const start = await attemptService.startAttempt(user, randomUUID(), {
      machineId: 'machine-a',
      clientBuild: '1.0.0',
      configVersion: 'v1-default',
    });

    const now = Date.now();
    const result = attemptService.ingestInputs(
      user,
      start.attemptId,
      start.attemptToken,
      {
        packets: [
          { seq: 1, clientTimeMs: now, moveX: 0.3, moveY: 0.4 },
          { seq: 1, clientTimeMs: now + 20, moveX: 0.1, moveY: 0.5 },
          { seq: 2, clientTimeMs: now + 40, moveX: -0.2, moveY: 0.6 },
        ],
      },
    );

    expect(result.acceptedSeqUpTo).toBe(2);
    expect(result.warnings.join(' ')).toContain('Duplicate seq 1 ignored');
  });

  it('resolve is idempotent', async () => {
    const user = auth('1003');
    const start = await attemptService.startAttempt(user, randomUUID(), {
      machineId: 'machine-a',
      clientBuild: '1.0.0',
      configVersion: 'v1-default',
    });

    attemptService.ingestInputs(user, start.attemptId, start.attemptToken, {
      packets: [{ seq: 1, clientTimeMs: Date.now(), moveX: 0.5, moveY: -0.2 }],
    });

    const idemKey = randomUUID();

    const first = await attemptService.resolveAttempt(
      user,
      start.attemptId,
      start.attemptToken,
      idemKey,
      {
        clientSummary: {
          pressTimeMs: 3200,
        },
      },
    );

    const second = await attemptService.resolveAttempt(
      user,
      start.attemptId,
      start.attemptToken,
      idemKey,
      {
        clientSummary: {
          pressTimeMs: 3200,
        },
      },
    );

    expect(second).toEqual(first);
  });

  it('claim is idempotent', async () => {
    const user = auth('1004');
    const start = await attemptService.startAttempt(user, randomUUID(), {
      machineId: 'machine-a',
      clientBuild: '1.0.0',
      configVersion: 'v1-default',
    });

    const attempt = db.attempts.get(start.attemptId) as Attempt;
    const forcedReward = rewardService.pickWeightedReward(0);
    rewardService.ensureGrantForWin(attempt, forcedReward.id);
    db.attempts.set(attempt.id, {
      ...attempt,
      status: 'resolved',
      result: 'win',
      rewardId: forcedReward.id,
      seedReveal: 'forced-seed',
      resolvedAt: Date.now(),
    });

    const idemKey = randomUUID();

    const first = await rewardService.claimReward(user.id, attempt.id, idemKey);
    const second = await rewardService.claimReward(
      user.id,
      attempt.id,
      idemKey,
    );

    expect(first.status).toBe('granted');
    expect(second).toEqual(first);
  });

  it('machine spawn plan is generated by backend', () => {
    const user = auth('1005');
    const plan = attemptService.getMachineSpawnPlan(user, 'machine-a', {
      count: 12,
    });

    expect(plan.machineId).toBe('machine-a');
    expect(plan.items.length).toBe(12);
    expect(plan.items.every((item) => typeof item.toyId === 'string')).toBe(
      true,
    );
  });
});
