import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Attempt, Reward, RewardGrant } from '../common/domain.types';
import { IdempotencyService } from '../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { InMemoryDatabaseService } from '../storage/in-memory-database.service';

function clampStock(reward: Reward): Reward {
  if (reward.stock === null) {
    return reward;
  }
  return {
    ...reward,
    stock: Math.max(0, reward.stock),
  };
}

@Injectable()
export class RewardService {
  private readonly logger = new Logger(RewardService.name);

  constructor(
    private readonly db: InMemoryDatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly auditService: AuditService,
  ) {
    if (this.db.rewards.size === 0) {
      this.logger.log('Reward storage is empty, seeding default rewards');
      this.seedRewards();
    }
  }

  getRewardById(rewardId: string): Reward {
    this.logger.debug(`Fetch reward rewardId=${rewardId}`);
    const reward = this.db.rewards.get(rewardId);
    if (!reward) {
      this.logger.warn(`Reward not found rewardId=${rewardId}`);
      throw new NotFoundException('Reward not found');
    }
    return reward;
  }

  pickWeightedReward(random01: number): Reward {
    this.logger.debug(`Weighted reward pick started random01=${random01}`);
    const active = [...this.db.rewards.values()].filter(
      (reward) =>
        reward.isActive && (reward.stock === null || reward.stock > 0),
    );

    if (active.length === 0) {
      this.logger.error('Weighted reward pick failed: no active rewards');
      throw new InternalServerErrorException('No active rewards configured');
    }

    const totalWeight = active.reduce((sum, reward) => sum + reward.weight, 0);
    const target = random01 * totalWeight;
    let cumulative = 0;

    for (const reward of active) {
      cumulative += reward.weight;
      if (target <= cumulative) {
        if (reward.stock !== null) {
          this.db.rewards.set(
            reward.id,
            clampStock({ ...reward, stock: reward.stock - 1 }),
          );
        }
        this.logger.log(
          `Reward selected rewardId=${reward.id} code=${reward.code} rarity=${reward.rarity}`,
        );
        return reward;
      }
    }

    this.logger.warn(
      'Weighted pick reached fallback branch, selecting last reward',
    );
    return active[active.length - 1];
  }

  ensureGrantForWin(attempt: Attempt, rewardId: string): RewardGrant {
    this.logger.log(
      `Ensure grant for win attemptId=${attempt.id} userId=${attempt.userId} rewardId=${rewardId}`,
    );
    const existingGrantId = this.db.rewardGrantsByAttemptId.get(attempt.id);
    if (existingGrantId) {
      const existing = this.db.rewardGrants.get(existingGrantId);
      if (!existing) {
        this.logger.error(
          `Grant index inconsistent attemptId=${attempt.id} existingGrantId=${existingGrantId}`,
        );
        throw new InternalServerErrorException('Grant index is inconsistent');
      }
      this.logger.debug(
        `Grant already exists attemptId=${attempt.id} grantId=${existing.id}`,
      );
      return existing;
    }

    const now = Date.now();
    const grant: RewardGrant = {
      id: randomUUID(),
      attemptId: attempt.id,
      userId: attempt.userId,
      rewardId,
      status: 'pending',
      idempotencyKey: randomUUID(),
      providerTxId: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.rewardGrants.set(grant.id, grant);
    this.db.rewardGrantsByAttemptId.set(attempt.id, grant.id);
    this.logger.log(
      `Grant created grantId=${grant.id} attemptId=${grant.attemptId}`,
    );
    return grant;
  }

  async claimReward(
    userId: string,
    attemptId: string,
    idempotencyKey: string,
  ): Promise<{
    status: 'granted' | 'already_granted' | 'pending' | 'failed';
    reward?: { code: string; rarity: string };
  }> {
    this.logger.log(
      `Claim flow started userId=${userId} attemptId=${attemptId} idem=${idempotencyKey}`,
    );
    return this.idempotency.run(
      `claim:${userId}:${attemptId}`,
      idempotencyKey,
      { attemptId },
      () => {
        const attempt = this.db.attempts.get(attemptId);
        if (!attempt || attempt.userId !== userId) {
          this.logger.warn(
            `Claim rejected: attempt not found or foreign userId=${userId} attemptId=${attemptId}`,
          );
          throw new NotFoundException('Attempt not found');
        }

        if (attempt.result !== 'win' || !attempt.rewardId) {
          this.logger.warn(
            `Claim rejected: attempt not claimable attemptId=${attemptId} result=${attempt.result}`,
          );
          throw new BadRequestException('Attempt has no claimable reward');
        }

        const grantId = this.db.rewardGrantsByAttemptId.get(attemptId);
        if (!grantId) {
          this.logger.error(
            `Claim failed: missing grant for winning attemptId=${attemptId}`,
          );
          throw new InternalServerErrorException(
            'Reward grant missing for winning attempt',
          );
        }

        const grant = this.db.rewardGrants.get(grantId);
        if (!grant) {
          this.logger.error(
            `Claim failed: grant state missing grantId=${grantId}`,
          );
          throw new InternalServerErrorException(
            'Reward grant state is inconsistent',
          );
        }

        const reward = this.getRewardById(grant.rewardId);

        if (grant.status === 'granted') {
          this.logger.log(
            `Claim idempotent already_granted attemptId=${attemptId} grantId=${grant.id}`,
          );
          return {
            status: 'already_granted' as const,
            reward: {
              code: reward.code,
              rarity: reward.rarity,
            },
          };
        }

        if (grant.status === 'failed') {
          this.logger.warn(
            `Claim returned failed status attemptId=${attemptId} grantId=${grant.id}`,
          );
          return {
            status: 'failed' as const,
          };
        }

        const updatedGrant: RewardGrant = {
          ...grant,
          status: 'granted',
          providerTxId: `local-${randomUUID()}`,
          updatedAt: Date.now(),
        };

        this.db.rewardGrants.set(grant.id, updatedGrant);
        this.db.attempts.set(attempt.id, {
          ...attempt,
          status: 'claimed',
        });
        this.logger.log(
          `Claim granted attemptId=${attemptId} grantId=${grant.id} rewardCode=${reward.code}`,
        );

        this.auditService.log(
          'reward.claimed',
          {
            grantId: grant.id,
            rewardId: reward.id,
          },
          userId,
          attemptId,
        );

        return {
          status: 'granted' as const,
          reward: {
            code: reward.code,
            rarity: reward.rarity,
          },
        };
      },
    );
  }

  private seedRewards(): void {
    const seeds: Array<
      Pick<Reward, 'code' | 'rarity' | 'weight' | 'isActive' | 'stock'>
    > = [
      {
        code: 'TOY_COMMON_BEAR',
        rarity: 'common',
        weight: 600,
        isActive: true,
        stock: null,
      },
      {
        code: 'TOY_RARE_CAT',
        rarity: 'rare',
        weight: 250,
        isActive: true,
        stock: 1000,
      },
      {
        code: 'TOY_EPIC_DINO',
        rarity: 'epic',
        weight: 120,
        isActive: true,
        stock: 350,
      },
      {
        code: 'TOY_LEGENDARY_DRAGON',
        rarity: 'legendary',
        weight: 30,
        isActive: true,
        stock: 50,
      },
    ];

    for (const seed of seeds) {
      const reward: Reward = {
        id: randomUUID(),
        ...seed,
      };
      this.db.rewards.set(reward.id, reward);
      this.db.rewardsByCode.set(reward.code, reward.id);
      this.logger.debug(
        `Seeded reward rewardId=${reward.id} code=${reward.code} rarity=${reward.rarity}`,
      );
    }
    this.logger.log(`Seeded rewards count=${seeds.length}`);
  }
}
