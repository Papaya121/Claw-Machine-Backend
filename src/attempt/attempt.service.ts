import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  Attempt,
  AttemptInput,
  AttemptOutcomeReason,
  AttemptResolveDebug,
  AttemptResult,
  AuthUserContext,
} from '../common/domain.types';
import { randomHex, sha256Hex } from '../common/crypto.util';
import { getEnvBool, getEnvInt, getEnvString } from '../common/env';
import { IdempotencyService } from '../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { AntiCheatService } from '../anti-cheat/anti-cheat.service';
import { GameSettingsService } from '../config/game-settings.service';
import { MachineConfigService } from '../config/machine-config.service';
import { RewardService } from '../reward/reward.service';
import { InMemoryDatabaseService } from '../storage/in-memory-database.service';
import { TokenService } from '../auth/token.service';
import { WalletService } from '../wallet/wallet.service';
import { ReplayResolverService } from './replay-resolver.service';
import type { ReplayResult } from './replay-resolver.service';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type ResolveResponse = {
  attemptId: string;
  status: 'resolved';
  result: AttemptResult;
  reward?: { id: string; code: string; rarity: number };
  spawnOnWinToyId?: string;
  seedReveal?: string;
  riskScore: number;
  debug?: AttemptResolveDebug;
};

type PreviewResponse = {
  attemptId: string;
  status: 'preview';
  predictedResultIfGrabbed: AttemptResult;
  shouldDropOnGrab: boolean;
  debug: AttemptResolveDebug;
};

type AntiCheatAccumulator = ReturnType<AntiCheatService['newAccumulator']>;

type EvaluatedAttemptOutcome = {
  acc: AntiCheatAccumulator;
  replay: ReplayResult;
  totalRisk: number;
  resolvedResult: AttemptResult;
  outcomeReason: AttemptOutcomeReason;
  keepChance: number | null;
  dropRoll: number | null;
  dropTriggered: boolean;
  rewardId: string | null;
  rewardPayload?: { id: string; code: string; rarity: number };
  spawnOnWinToyId?: string;
  resolveDebug: AttemptResolveDebug;
};

@Injectable()
export class AttemptService {
  private readonly logger = new Logger(AttemptService.name);

  private readonly inputRateLimitPerSec = getEnvInt(
    'INPUT_RATE_LIMIT_PER_SEC',
    30,
  );

  private readonly attemptTtlSec = getEnvInt('ATTEMPT_TTL_SEC', 60 * 5);
  private readonly attemptResultWebhookEnabled = getEnvBool(
    'ATTEMPT_RESULT_WEBHOOK_ENABLED',
    true,
  );
  private readonly attemptResultWebhookUrl = getEnvString(
    'ATTEMPT_RESULT_WEBHOOK_URL',
    '',
  ).trim();
  private readonly attemptResultWebhookTimeoutMs = getEnvInt(
    'ATTEMPT_RESULT_WEBHOOK_TIMEOUT_MS',
    1500,
  );
  private readonly attemptResultWebhookAuthToken = getEnvString(
    'ATTEMPT_RESULT_WEBHOOK_AUTH_TOKEN',
    '',
  ).trim();
  private readonly attemptResultWebhookIncludeSeed = getEnvBool(
    'ATTEMPT_RESULT_WEBHOOK_INCLUDE_SEED',
    false,
  );

  constructor(
    private readonly db: InMemoryDatabaseService,
    private readonly walletService: WalletService,
    private readonly idempotency: IdempotencyService,
    private readonly tokenService: TokenService,
    private readonly configService: MachineConfigService,
    private readonly gameSettingsService: GameSettingsService,
    private readonly auditService: AuditService,
    private readonly antiCheatService: AntiCheatService,
    private readonly replayResolver: ReplayResolverService,
    private readonly rewardService: RewardService,
  ) {}

  async startAttempt(
    user: AuthUserContext,
    idempotencyKey: string,
    body: { machineId?: string; clientBuild?: string; configVersion?: string },
  ): Promise<{
    attemptId: string;
    attemptToken: string;
    serverNowMs: number;
    inputWindowMs: number;
    economySnapshot: { ticketsLeft: number };
  }> {
    const machineId = (body.machineId || '').trim();
    const clientBuild = (body.clientBuild || '').trim();
    const configVersion = (body.configVersion || '').trim();
    this.logger.log(
      `Start attempt requested userId=${user.id} machineId=${machineId} configVersion=${configVersion}`,
    );

    if (!machineId || !clientBuild || !configVersion) {
      this.logger.warn(
        `Start attempt rejected for userId=${user.id}: missing required fields`,
      );
      throw new BadRequestException(
        'machineId, clientBuild and configVersion are required',
      );
    }

    return this.idempotency.run(
      `attempt:start:${user.id}`,
      idempotencyKey,
      { machineId, clientBuild, configVersion },
      () => {
        this.logger.debug(
          `Start attempt idempotency miss userId=${user.id} idem=${idempotencyKey}`,
        );
        const config = this.configService.get(configVersion);
        const wallet = this.walletService.debitTicket(user.id);

        const outcomeSeed = randomHex(32);
        const attempt: Attempt = {
          id: randomUUID(),
          userId: user.id,
          status: 'started',
          configVersion,
          seedHash: sha256Hex(outcomeSeed),
          outcomeSeed,
          seedReveal: null,
          startedAt: Date.now(),
          resolvedAt: null,
          expiresAt: Date.now() + this.attemptTtlSec * 1000,
          riskScore: 0,
          result: null,
          rewardId: null,
          resolveDebug: null,
          machineId,
          clientBuild,
        };

        this.db.attempts.set(attempt.id, attempt);
        this.db.attemptInputs.set(attempt.id, []);
        this.logger.log(
          `Attempt started attemptId=${attempt.id} userId=${user.id} ticketsLeft=${wallet.tickets}`,
        );

        this.auditService.log(
          'attempt.started',
          {
            machineId,
            clientBuild,
            configVersion,
            seedHash: attempt.seedHash,
          },
          user.id,
          attempt.id,
        );

        return {
          attemptId: attempt.id,
          attemptToken: this.tokenService.issueAttemptToken(
            user.id,
            attempt.id,
          ),
          serverNowMs: Date.now(),
          inputWindowMs: config.inputWindowMs,
          economySnapshot: {
            ticketsLeft: wallet.tickets,
          },
        };
      },
    );
  }

  ingestInputs(
    user: AuthUserContext,
    attemptId: string,
    attemptToken: string | undefined,
    body: {
      packets?: Array<{
        seq: number;
        clientTimeMs: number;
        moveX: number;
        moveY: number;
      }>;
    },
  ): {
    acceptedSeqUpTo: number;
    serverNowMs: number;
    warnings: string[];
  } {
    this.logger.log(
      `Ingest inputs requested userId=${user.id} attemptId=${attemptId} packets=${body.packets?.length ?? 0}`,
    );
    if (!attemptToken) {
      this.logger.warn(
        `Ingest inputs rejected userId=${user.id} attemptId=${attemptId}: missing attempt token`,
      );
      throw new ForbiddenException('X-Attempt-Token header is required');
    }

    const attempt = this.getUserAttempt(user.id, attemptId);
    if (
      attempt.status === 'resolved' ||
      attempt.status === 'claimed' ||
      attempt.status === 'cancelled'
    ) {
      this.logger.warn(
        `Ingest inputs rejected attemptId=${attemptId}: status=${attempt.status}`,
      );
      throw new BadRequestException('Attempt no longer accepts inputs');
    }

    this.tokenService.verifyAttemptToken(attemptToken, user.id, attemptId);

    const packets = body.packets || [];
    const sorted = [...packets].sort((a, b) => a.seq - b.seq);
    const existing = this.db.attemptInputs.get(attemptId) || [];
    const acc = this.antiCheatService.newAccumulator();

    let acceptedSeq = existing.length ? existing[existing.length - 1].seq : 0;
    const existingSeqs = new Set(existing.map((input) => input.seq));

    for (const packet of sorted) {
      if (!Number.isInteger(packet.seq) || packet.seq < 1) {
        throw new BadRequestException('seq must be positive integer');
      }
      if (!Number.isFinite(packet.clientTimeMs)) {
        throw new BadRequestException('clientTimeMs must be number');
      }
      if (!Number.isFinite(packet.moveX) || !Number.isFinite(packet.moveY)) {
        throw new BadRequestException('moveX/moveY must be numbers');
      }

      this.antiCheatService.applyInputChecks(
        acc,
        attempt,
        existing,
        packet,
        Date.now(),
        this.inputRateLimitPerSec,
      );

      if (existingSeqs.has(packet.seq)) {
        acc.warnings.push(`Duplicate seq ${packet.seq} ignored`);
        this.logger.debug(
          `Duplicate packet ignored attemptId=${attemptId} seq=${packet.seq}`,
        );
        continue;
      }

      const normalized: AttemptInput = {
        attemptId,
        seq: packet.seq,
        clientTimeMs: packet.clientTimeMs,
        dirX: clamp(packet.moveX, -1, 1),
        dirY: clamp(packet.moveY, -1, 1),
        receivedAt: Date.now(),
      };

      existing.push(normalized);
      existingSeqs.add(packet.seq);
      acceptedSeq = Math.max(acceptedSeq, packet.seq);
    }

    this.db.attemptInputs.set(
      attemptId,
      existing.sort((a, b) => a.seq - b.seq),
    );

    if (attempt.status === 'started') {
      this.db.attempts.set(attempt.id, {
        ...attempt,
        status: 'inputs_closed',
        riskScore: attempt.riskScore + acc.riskScore,
      });
    }

    this.antiCheatService.persistFlags(acc);
    this.logger.log(
      `Inputs ingested attemptId=${attemptId} acceptedSeqUpTo=${acceptedSeq} riskIncrement=${acc.riskScore} warnings=${acc.warnings.length}`,
    );

    this.auditService.log(
      'attempt.inputs_ingested',
      {
        acceptedSeq,
        packetCount: packets.length,
        warnings: acc.warnings,
        riskIncrement: acc.riskScore,
      },
      user.id,
      attempt.id,
    );

    return {
      acceptedSeqUpTo: acceptedSeq,
      serverNowMs: Date.now(),
      warnings: acc.warnings,
    };
  }

  getMachineSpawnPlan(
    user: AuthUserContext,
    machineId: string,
  ): {
    machineId: string;
    serverNowMs: number;
    items: Array<{ toyId: string }>;
  } {
    const normalizedMachineId = (machineId ?? '').trim();
    if (!normalizedMachineId) {
      throw new BadRequestException('machineId is required');
    }

    const count = this.gameSettingsService.getSpawnPlanConfig().itemCount;
    const plannedItems: Array<{ toyId: string; rarity: number }> = [];

    for (let i = 0; i < count; i++) {
      const reward = this.rewardService.pickWeightedRewardForSpawn(
        Math.random(),
      );
      plannedItems.push({ toyId: reward.code, rarity: reward.rarity });
    }
    plannedItems.sort((a, b) => b.rarity - a.rarity);
    const items = plannedItems.map((item) => ({ toyId: item.toyId }));

    this.auditService.log(
      'machine.spawn_plan_issued',
      {
        machineId: normalizedMachineId,
        count,
      },
      user.id,
      undefined,
    );

    return {
      machineId: normalizedMachineId,
      serverNowMs: Date.now(),
      items,
    };
  }

  previewAttemptIfGrabbed(
    user: AuthUserContext,
    attemptId: string,
    attemptToken: string | undefined,
    body: {
      clientSummary?: {
        pressTimeMs?: number;
        closeStartMs?: number;
        contactHints?: Array<{ toyHintId: string; fingers: number }>;
      };
    },
  ): PreviewResponse {
    this.logger.log(
      `Preview requested userId=${user.id} attemptId=${attemptId}`,
    );
    if (!attemptToken) {
      this.logger.warn(
        `Preview rejected userId=${user.id} attemptId=${attemptId}: missing attempt token`,
      );
      throw new ForbiddenException('X-Attempt-Token header is required');
    }

    const summary = body.clientSummary;
    if (!summary || !Number.isFinite(summary.pressTimeMs)) {
      this.logger.warn(
        `Preview rejected userId=${user.id} attemptId=${attemptId}: invalid clientSummary`,
      );
      throw new BadRequestException('clientSummary.pressTimeMs is required');
    }

    const attempt = this.getUserAttempt(user.id, attemptId);
    this.tokenService.verifyAttemptToken(attemptToken, user.id, attemptId);

    if (Date.now() > attempt.expiresAt) {
      return {
        attemptId: attempt.id,
        status: 'preview',
        predictedResultIfGrabbed: 'void',
        shouldDropOnGrab: true,
        debug: this.buildExpiredResolveDebug(true),
      };
    }

    const evaluated = this.evaluateAttemptOutcome(attempt, summary, true);
    return {
      attemptId: attempt.id,
      status: 'preview',
      predictedResultIfGrabbed: evaluated.resolvedResult,
      shouldDropOnGrab: evaluated.resolvedResult !== 'win',
      debug: evaluated.resolveDebug,
    };
  }

  async resolveAttempt(
    user: AuthUserContext,
    attemptId: string,
    attemptToken: string | undefined,
    idempotencyKey: string,
    body: {
      clientSummary?: {
        pressTimeMs?: number;
        closeStartMs?: number;
        localGrabObserved?: boolean;
        contactHints?: Array<{ toyHintId: string; fingers: number }>;
      };
    },
  ): Promise<ResolveResponse> {
    this.logger.log(
      `Resolve requested userId=${user.id} attemptId=${attemptId} idem=${idempotencyKey}`,
    );
    if (!attemptToken) {
      this.logger.warn(
        `Resolve rejected userId=${user.id} attemptId=${attemptId}: missing attempt token`,
      );
      throw new ForbiddenException('X-Attempt-Token header is required');
    }

    const summary = body.clientSummary;
    if (!summary || !Number.isFinite(summary.pressTimeMs)) {
      this.logger.warn(
        `Resolve rejected userId=${user.id} attemptId=${attemptId}: invalid clientSummary`,
      );
      throw new BadRequestException('clientSummary.pressTimeMs is required');
    }

    return this.idempotency.run(
      `attempt:resolve:${user.id}:${attemptId}`,
      idempotencyKey,
      body,
      () => {
        const attempt = this.getUserAttempt(user.id, attemptId);
        this.logger.debug(
          `Resolve started attemptId=${attemptId} status=${attempt.status}`,
        );
        this.tokenService.verifyAttemptToken(attemptToken, user.id, attemptId);

        if (attempt.status === 'resolved' || attempt.status === 'claimed') {
          this.logger.log(
            `Resolve returned cached state attemptId=${attemptId} status=${attempt.status}`,
          );
          const response = this.buildResolveResponse(attempt);
          this.dispatchAttemptResultWebhook(attempt, response, user.id);
          return response;
        }

        if (Date.now() > attempt.expiresAt) {
          this.logger.warn(`Resolve expired attemptId=${attemptId}`);
          const expired = {
            ...attempt,
            status: 'cancelled' as const,
            result: 'void' as const,
            resolvedAt: Date.now(),
            seedReveal: attempt.outcomeSeed,
            resolveDebug: this.buildExpiredResolveDebug(
              summary.localGrabObserved === true,
            ),
          };
          this.db.attempts.set(expired.id, expired);
          const response = this.buildResolveResponse(expired);
          this.dispatchAttemptResultWebhook(expired, response, user.id);
          return response;
        }

        const localGrabObserved = summary.localGrabObserved === true;
        const evaluated = this.evaluateAttemptOutcome(
          attempt,
          summary,
          localGrabObserved,
        );
        const rewardPayload = evaluated.rewardPayload;
        const spawnOnWinToyId = evaluated.spawnOnWinToyId;
        const rewardId = evaluated.rewardId;

        if (evaluated.resolvedResult === 'win' && rewardId) {
          this.rewardService.consumeStock(rewardId);
          this.rewardService.ensureGrantForWin(attempt, rewardId);
          this.logger.log(
            `Resolve produced win attemptId=${attemptId} rewardId=${rewardId}`,
          );
        }

        if (evaluated.dropTriggered && rewardPayload != null) {
          this.logger.log(
            `Resolve dropped-after-grab attemptId=${attemptId} rewardCode=${rewardPayload.code} keepChance=${evaluated.keepChance} dropRoll=${evaluated.dropRoll}`,
          );
        }

        this.logger.log(
          `Resolve computed attemptId=${attemptId} result=${evaluated.resolvedResult} reason=${evaluated.outcomeReason} riskScore=${evaluated.totalRisk} chance=${evaluated.resolveDebug.chance} keepChance=${evaluated.keepChance ?? 'n/a'}`,
        );

        const resolved: Attempt = {
          ...attempt,
          status: 'resolved',
          riskScore: evaluated.totalRisk,
          resolvedAt: Date.now(),
          result: evaluated.resolvedResult,
          rewardId,
          seedReveal: attempt.outcomeSeed,
          resolveDebug: evaluated.resolveDebug,
        };

        this.db.attempts.set(attempt.id, resolved);

        this.antiCheatService.persistFlags(evaluated.acc);
        this.logger.debug(
          `Resolve anti-cheat persisted attemptId=${attemptId} flags=${evaluated.acc.flags.length}`,
        );

        this.auditService.log(
          'attempt.resolved',
          {
            result: resolved.result,
            riskScore: resolved.riskScore,
            chance: evaluated.resolveDebug.chance,
            rewardRoll: evaluated.resolveDebug.rewardRoll,
            keepChance: evaluated.keepChance,
            dropRoll: evaluated.dropRoll,
            dropTriggered: evaluated.dropTriggered,
            outcomeReason: evaluated.outcomeReason,
            localGrabObserved,
            serverValidatedGrab: evaluated.resolveDebug.serverValidatedGrab,
            rewardId: resolved.rewardId,
            replay: evaluated.replay,
          },
          user.id,
          attempt.id,
        );

        const response = {
          attemptId: resolved.id,
          status: 'resolved' as const,
          result: evaluated.resolvedResult,
          reward: rewardPayload,
          spawnOnWinToyId,
          seedReveal: resolved.seedReveal ?? undefined,
          riskScore: resolved.riskScore,
          debug: evaluated.resolveDebug,
        };
        this.dispatchAttemptResultWebhook(resolved, response, user.id);
        return response;
      },
    );
  }

  private buildExpiredResolveDebug(
    localGrabObserved: boolean,
  ): AttemptResolveDebug {
    return {
      outcomeReason: 'expired',
      chance: 0,
      rewardRoll: 0,
      keepChance: null,
      dropRoll: null,
      dropTriggered: false,
      localGrabObserved,
      serverValidatedGrab: false,
      replay: {
        dropAlignment: 0,
        stability: 0,
        timingQuality: 0,
        lockedPhaseMovement: false,
        skillScore: 0,
      },
    };
  }

  private evaluateAttemptOutcome(
    attempt: Attempt,
    summary: {
      pressTimeMs?: number;
      closeStartMs?: number;
      localGrabObserved?: boolean;
      contactHints?: Array<{ toyHintId: string; fingers: number }>;
    },
    localGrabObserved: boolean,
  ): EvaluatedAttemptOutcome {
    const config = this.configService.get(attempt.configVersion);
    const inputs = this.db.attemptInputs.get(attempt.id) || [];
    const acc = this.antiCheatService.newAccumulator();
    const replay = this.replayResolver.replay(config, inputs, {
      pressTimeMs: summary.pressTimeMs ?? 0,
      closeStartMs: summary.closeStartMs,
    });
    const serverValidatedGrab =
      replay.dropAlignment >= config.economy.grabValidationMinAlignment &&
      replay.skillScore >= config.economy.grabValidationMinSkill;

    const recentAttempts = [...this.db.attempts.values()]
      .filter(
        (candidate) =>
          candidate.userId === attempt.userId && candidate.result !== null,
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20);

    const wins = recentAttempts.filter(
      (candidate) => candidate.result === 'win',
    ).length;
    const recentWinRate =
      recentAttempts.length > 0 ? wins / recentAttempts.length : 0;

    this.antiCheatService.applyBehaviorChecks(acc, attempt, {
      repeatedPrecisionBin: replay.repeatedPrecisionBin,
      recentWinRate,
      lockedPhaseMovement: replay.lockedPhaseMovement,
    });
    this.antiCheatService.applyResolveChecks(acc, attempt, {
      localGrabObserved,
      serverValidatedGrab,
      dropAlignment: replay.dropAlignment,
      skillScore: replay.skillScore,
      pressTimeMs: summary.pressTimeMs ?? 0,
      closeStartMs: summary.closeStartMs,
    });

    const totalRisk = attempt.riskScore + acc.riskScore;
    const outcomeSeed = attempt.outcomeSeed;
    const outcome = this.replayResolver.resolveOutcome(
      config,
      replay,
      outcomeSeed,
      totalRisk,
      { localGrabObserved, serverValidatedGrab },
    );

    let resolvedResult: AttemptResult = outcome.result;
    let outcomeReason: AttemptOutcomeReason = outcome.outcomeReason;
    let keepChance: number | null = null;
    let dropRoll: number | null = null;
    let dropTriggered = false;
    let rewardId: string | null = null;
    let rewardPayload:
      | { id: string; code: string; rarity: number }
      | undefined;
    let spawnOnWinToyId: string | undefined;

    if (outcome.result === 'win') {
      const reward = this.rewardService.pickWeightedReward(
        this.replayResolver.randomForReward(outcomeSeed),
      );
      keepChance = clamp(reward.chance, 0, 1);
      dropRoll = this.replayResolver.randomForDrop(outcomeSeed);
      dropTriggered = dropRoll > keepChance;

      if (dropTriggered) {
        resolvedResult = 'lose';
        outcomeReason = 'dropped_after_grab';
      } else {
        rewardId = reward.id;
        rewardPayload = {
          id: reward.id,
          code: reward.code,
          rarity: reward.rarity,
        };
        spawnOnWinToyId = this.resolveSpawnOnWinToyId(outcomeSeed);
      }
    }

    return {
      acc,
      replay,
      totalRisk,
      resolvedResult,
      outcomeReason,
      keepChance,
      dropRoll,
      dropTriggered,
      rewardId,
      rewardPayload,
      spawnOnWinToyId,
      resolveDebug: {
        outcomeReason,
        chance: outcome.chance,
        rewardRoll: outcome.rewardRoll,
        keepChance,
        dropRoll,
        dropTriggered,
        localGrabObserved,
        serverValidatedGrab,
        replay: {
          dropAlignment: replay.dropAlignment,
          stability: replay.stability,
          timingQuality: replay.timingQuality,
          lockedPhaseMovement: replay.lockedPhaseMovement,
          skillScore: replay.skillScore,
        },
      },
    };
  }

  private getUserAttempt(userId: string, attemptId: string): Attempt {
    const attempt = this.db.attempts.get(attemptId);
    if (!attempt) {
      this.logger.warn(`Attempt not found attemptId=${attemptId}`);
      throw new NotFoundException('Attempt not found');
    }
    if (attempt.userId !== userId) {
      this.logger.warn(
        `Attempt access denied attemptId=${attemptId} owner=${attempt.userId} caller=${userId}`,
      );
      throw new ForbiddenException('Attempt belongs to another user');
    }
    return attempt;
  }

  private buildResolveResponse(attempt: Attempt): ResolveResponse {
    const reward = attempt.rewardId
      ? this.rewardService.getRewardById(attempt.rewardId)
      : undefined;
    const result: AttemptResult = attempt.result ?? 'void';

    return {
      attemptId: attempt.id,
      status: 'resolved',
      result,
      reward: reward
        ? {
            id: reward.id,
            code: reward.code,
            rarity: reward.rarity,
          }
        : undefined,
      spawnOnWinToyId:
        result === 'win'
          ? this.resolveSpawnOnWinToyId(attempt.seedReveal ?? attempt.id)
          : undefined,
      seedReveal: attempt.seedReveal ?? undefined,
      riskScore: attempt.riskScore,
      debug: attempt.resolveDebug ?? undefined,
    };
  }

  private dispatchAttemptResultWebhook(
    attempt: Attempt,
    response: {
      attemptId: string;
      status: 'resolved';
      result: AttemptResult;
      reward?: { id: string; code: string; rarity: number };
      spawnOnWinToyId?: string;
      seedReveal?: string;
      riskScore: number;
    },
    userId: string,
  ): void {
    if (
      !this.attemptResultWebhookEnabled ||
      !this.attemptResultWebhookUrl.length
    ) {
      return;
    }

    const payload: Record<string, unknown> = {
      eventType: 'attempt.resolved',
      attemptId: response.attemptId,
      userId,
      result: response.result,
      status: response.status,
      riskScore: response.riskScore,
      reward: response.reward ?? null,
      spawnOnWinToyId: response.spawnOnWinToyId ?? null,
      machineId: attempt.machineId,
      configVersion: attempt.configVersion,
      clientBuild: attempt.clientBuild,
      startedAt: attempt.startedAt,
      resolvedAt: attempt.resolvedAt,
      serverNowMs: Date.now(),
    };

    if (this.attemptResultWebhookIncludeSeed) {
      payload.seedReveal = response.seedReveal ?? null;
    }

    void this.sendAttemptResultWebhook(payload);
  }

  private async sendAttemptResultWebhook(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutMs = Math.max(100, this.attemptResultWebhookTimeoutMs);
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.attemptResultWebhookAuthToken.length > 0) {
        headers.Authorization = `Bearer ${this.attemptResultWebhookAuthToken}`;
      }

      const response = await fetch(this.attemptResultWebhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.logger.warn(
          `Attempt result webhook failed status=${response.status} body=${text || '<empty>'}`,
        );
        return;
      }

      this.logger.debug(
        `Attempt result webhook sent status=${response.status} url=${this.attemptResultWebhookUrl}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      this.logger.warn(`Attempt result webhook error: ${message}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private resolveSpawnOnWinToyId(
    seed: string | null | undefined,
  ): string | undefined {
    const effectiveSeed =
      typeof seed === 'string' && seed.trim().length > 0
        ? seed
        : randomUUID();
    return this.rewardService.pickSpawnOnWinToyId(
      this.replayResolver.randomForSpawnOnWin(effectiveSeed),
    );
  }
}
