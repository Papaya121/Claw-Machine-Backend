import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { AttemptInput } from '../common/domain.types';
import type { MachineConfig } from '../config/machine-config.types';

export interface ReplayResult {
  dropAlignment: number;
  stability: number;
  timingQuality: number;
  lockedPhaseMovement: boolean;
  repeatedPrecisionBin: number;
  skillScore: number;
  lastPosition: { x: number; y: number };
}

export interface ResolveOutcome {
  result: 'win' | 'lose' | 'void';
  chance: number;
  rewardRoll: number;
  outcomeReason:
    | 'void_risk'
    | 'grab_not_validated'
    | 'chance_roll_failed'
    | 'win';
  seedReveal: string;
  replay: ReplayResult;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomFromSeed(seed: string, stream: number): number {
  const digest = createHash('sha256').update(`${seed}:${stream}`).digest();
  const intValue = digest.readUInt32BE(0);
  return intValue / 0xffffffff;
}

@Injectable()
export class ReplayResolverService {
  private readonly logger = new Logger(ReplayResolverService.name);

  replay(
    config: MachineConfig,
    inputs: AttemptInput[],
    summary: {
      pressTimeMs: number;
      closeStartMs?: number;
    },
  ): ReplayResult {
    this.logger.debug(
      `Replay start inputs=${inputs.length} pressTimeMs=${summary.pressTimeMs} closeStartMs=${summary.closeStartMs ?? 'n/a'}`,
    );
    const sorted = [...inputs].sort((a, b) => a.seq - b.seq);
    const baselineMs = sorted.length > 0 ? sorted[0].clientTimeMs : 0;
    const normalizeTime = (timeMs: number | undefined): number => {
      if (!Number.isFinite(timeMs)) {
        return 0;
      }
      const raw =
        timeMs && timeMs > config.inputWindowMs * 10
          ? timeMs - baselineMs
          : (timeMs ?? 0);
      return clamp(raw, 0, config.inputWindowMs);
    };
    const normalized = sorted.map((packet) => ({
      ...packet,
      clientTimeMs: normalizeTime(packet.clientTimeMs),
    }));

    const dtSec = config.dtMs / 1000;

    const normalizedPressTimeMs = normalizeTime(summary.pressTimeMs);
    const normalizedCloseStartMs =
      summary.closeStartMs === undefined
        ? undefined
        : normalizeTime(summary.closeStartMs);
    const simulationEndMs = Math.max(
      normalizedPressTimeMs,
      normalized.length ? normalized[normalized.length - 1].clientTimeMs : 0,
    );

    let posX = 0;
    let posY = 0;
    let velX = 0;
    let velY = 0;
    let inputIndex = 0;
    let cmdX = 0;
    let cmdY = 0;
    let jitterSum = 0;
    let commandChanges = 0;
    let lockedPhaseMovement = false;

    for (let t = 0; t <= simulationEndMs; t += config.dtMs) {
      while (
        inputIndex < normalized.length &&
        normalized[inputIndex].clientTimeMs <= t
      ) {
        const next = normalized[inputIndex];
        const dx = Math.abs(next.dirX - cmdX);
        const dy = Math.abs(next.dirY - cmdY);
        jitterSum += dx + dy;
        if (dx + dy > 0.2) {
          commandChanges += 1;
        }
        cmdX = next.dirX;
        cmdY = next.dirY;
        inputIndex += 1;

        if (
          normalizedCloseStartMs !== undefined &&
          next.clientTimeMs >= normalizedCloseStartMs
        ) {
          if (Math.abs(next.dirX) > 0.05 || Math.abs(next.dirY) > 0.05) {
            lockedPhaseMovement = true;
          }
        }
      }

      const accelX = cmdX * config.movement.acceleration;
      const accelY = cmdY * config.movement.acceleration;

      velX += accelX * dtSec;
      velY += accelY * dtSec;

      const damping = Math.max(0, 1 - config.movement.damping * dtSec);
      velX *= damping;
      velY *= damping;

      velX = clamp(velX, -config.movement.maxSpeed, config.movement.maxSpeed);
      velY = clamp(velY, -config.movement.maxSpeed, config.movement.maxSpeed);

      posX = clamp(
        posX + velX * dtSec,
        config.movement.minX,
        config.movement.maxX,
      );
      posY = clamp(
        posY + velY * dtSec,
        config.movement.minY,
        config.movement.maxY,
      );
    }

    const dx = posX - config.dropTarget.x;
    const dy = posY - config.dropTarget.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = Math.sqrt(
      (config.movement.maxX - config.movement.minX) ** 2 +
        (config.movement.maxY - config.movement.minY) ** 2,
    );

    const dropAlignment = clamp(1 - distance / (maxDistance || 1), 0, 1);
    const stability = clamp(
      1 - jitterSum / Math.max(12, normalized.length * 1.8),
      0,
      1,
    );

    const timingDelta = Math.abs(
      normalizedPressTimeMs - config.timing.expectedPressMs,
    );
    const timingQuality = clamp(1 - timingDelta / config.inputWindowMs, 0, 1);

    const anomalyPenalty = lockedPhaseMovement ? 0.35 : 0;
    const skillScore =
      0.55 * dropAlignment +
      0.25 * stability +
      0.2 * timingQuality -
      anomalyPenalty;

    const positionBin = Math.round(dropAlignment * 10);
    const repeatedPrecisionBin = positionBin >= 9 ? commandChanges : 0;

    const replayResult = {
      dropAlignment,
      stability,
      timingQuality,
      lockedPhaseMovement,
      repeatedPrecisionBin,
      skillScore: clamp(skillScore, 0, 1),
      lastPosition: { x: posX, y: posY },
    };
    this.logger.debug(
      `Replay complete dropAlignment=${replayResult.dropAlignment.toFixed(3)} stability=${replayResult.stability.toFixed(3)} timing=${replayResult.timingQuality.toFixed(3)} skill=${replayResult.skillScore.toFixed(3)}`,
    );
    return replayResult;
  }

  resolveOutcome(
    config: MachineConfig,
    replay: ReplayResult,
    seed: string,
    riskScore: number,
    context: {
      localGrabObserved: boolean;
      serverValidatedGrab: boolean;
    },
  ): ResolveOutcome {
    this.logger.debug(
      `Resolve outcome calc riskScore=${riskScore} skill=${replay.skillScore.toFixed(3)}`,
    );
    const chance = clamp(
      config.economy.baseWinChance +
        replay.skillScore * config.economy.skillScale -
        riskScore * config.economy.riskScale,
      config.economy.minChance,
      config.economy.maxChance,
    );

    const rewardRoll = randomFromSeed(seed, 0);

    if (riskScore >= config.economy.voidRiskThreshold) {
      this.logger.warn(
        `Resolve outcome forced void riskScore=${riskScore} threshold=${config.economy.voidRiskThreshold}`,
      );
      return {
        result: 'void',
        chance,
        rewardRoll,
        outcomeReason: 'void_risk',
        seedReveal: seed,
        replay,
      };
    }

    if (!context.localGrabObserved || !context.serverValidatedGrab) {
      return {
        result: 'lose',
        chance,
        rewardRoll,
        outcomeReason: 'grab_not_validated',
        seedReveal: seed,
        replay,
      };
    }

    if (rewardRoll > chance) {
      return {
        result: 'lose',
        chance,
        rewardRoll,
        outcomeReason: 'chance_roll_failed',
        seedReveal: seed,
        replay,
      };
    }

    return {
      result: 'win',
      chance,
      rewardRoll,
      outcomeReason: 'win',
      seedReveal: seed,
      replay,
    };
  }

  randomForReward(seed: string): number {
    return randomFromSeed(seed, 1);
  }

  randomForDrop(seed: string): number {
    return randomFromSeed(seed, 2);
  }

  randomForSpawnOnWin(seed: string): number {
    return randomFromSeed(seed, 3);
  }
}
