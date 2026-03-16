import { Injectable, Logger } from '@nestjs/common';
import type {
  AntiCheatFlag,
  Attempt,
  AttemptInput,
} from '../common/domain.types';
import { InMemoryDatabaseService } from '../storage/in-memory-database.service';

export interface RiskAccumulator {
  riskScore: number;
  warnings: string[];
  flags: Omit<AntiCheatFlag, 'id' | 'createdAt'>[];
}

@Injectable()
export class AntiCheatService {
  private readonly logger = new Logger(AntiCheatService.name);

  constructor(private readonly db: InMemoryDatabaseService) {}

  newAccumulator(): RiskAccumulator {
    return {
      riskScore: 0,
      warnings: [],
      flags: [],
    };
  }

  applyInputChecks(
    acc: RiskAccumulator,
    attempt: Attempt,
    existingInputs: AttemptInput[],
    packet: {
      seq: number;
      clientTimeMs: number;
      moveX: number;
      moveY: number;
    },
    nowMs: number,
    inputRateLimitPerSec: number,
  ): void {
    const previous = existingInputs[existingInputs.length - 1];

    if (previous) {
      if (packet.seq <= previous.seq) {
        this.addFlag(acc, attempt, 'seq_non_monotonic', 10, {
          prevSeq: previous.seq,
          currentSeq: packet.seq,
        });
      }

      if (packet.seq - previous.seq > 200) {
        this.addFlag(acc, attempt, 'seq_jump_too_large', 20, {
          prevSeq: previous.seq,
          currentSeq: packet.seq,
        });
        acc.warnings.push('Large sequence jump detected');
      }

      const dtMs = packet.clientTimeMs - previous.clientTimeMs;
      if (dtMs > 0) {
        const rate = 1000 / dtMs;
        if (rate > inputRateLimitPerSec) {
          this.addFlag(acc, attempt, 'input_rate_limit_violation', 15, {
            packetRate: Number(rate.toFixed(2)),
            limit: inputRateLimitPerSec,
          });
          acc.warnings.push('Input rate exceeded limit');
        }
      }
    }

    const clientSkew = Math.abs(nowMs - packet.clientTimeMs);
    if (clientSkew > 10_000) {
      this.addFlag(acc, attempt, 'client_clock_skew', 8, {
        skewMs: clientSkew,
      });
    }

    if (
      packet.moveX < -1 ||
      packet.moveX > 1 ||
      packet.moveY < -1 ||
      packet.moveY > 1
    ) {
      this.addFlag(acc, attempt, 'raw_input_out_of_range', 5, {
        moveX: packet.moveX,
        moveY: packet.moveY,
      });
    }
  }

  applyBehaviorChecks(
    acc: RiskAccumulator,
    attempt: Attempt,
    telemetry: {
      repeatedPrecisionBin: number;
      recentWinRate: number;
      lockedPhaseMovement: boolean;
    },
  ): void {
    if (telemetry.lockedPhaseMovement) {
      this.addFlag(acc, attempt, 'movement_during_locked_phase', 20, {});
    }

    if (telemetry.repeatedPrecisionBin > 3) {
      this.addFlag(acc, attempt, 'repeated_precision_trajectory', 12, {
        count: telemetry.repeatedPrecisionBin,
      });
    }

    if (telemetry.recentWinRate > 0.75) {
      this.addFlag(acc, attempt, 'abnormal_win_rate', 25, {
        recentWinRate: telemetry.recentWinRate,
      });
    }
  }

  applyResolveChecks(
    acc: RiskAccumulator,
    attempt: Attempt,
    telemetry: {
      localGrabObserved: boolean;
      serverValidatedGrab: boolean;
      dropAlignment: number;
      skillScore: number;
      pressTimeMs: number;
      closeStartMs?: number;
    },
  ): void {
    if (
      telemetry.localGrabObserved &&
      telemetry.closeStartMs !== undefined &&
      telemetry.closeStartMs < telemetry.pressTimeMs
    ) {
      this.addFlag(acc, attempt, 'close_before_press', 10, {
        pressTimeMs: telemetry.pressTimeMs,
        closeStartMs: telemetry.closeStartMs,
      });
    }

    if (telemetry.localGrabObserved && !telemetry.serverValidatedGrab) {
      this.addFlag(acc, attempt, 'grab_claim_not_validated', 18, {
        dropAlignment: Number(telemetry.dropAlignment.toFixed(4)),
        skillScore: Number(telemetry.skillScore.toFixed(4)),
      });
      acc.warnings.push('Client grab claim not validated by server replay');
    }
  }

  persistFlags(acc: RiskAccumulator): void {
    for (const flag of acc.flags) {
      this.db.antiCheatFlags.push({
        ...flag,
        id: this.db.antiCheatSequence++,
        createdAt: Date.now(),
      });
      this.logger.warn(
        `Anti-cheat flag persisted attemptId=${flag.attemptId} userId=${flag.userId} type=${flag.flagType} severity=${flag.severity}`,
      );
    }
  }

  private addFlag(
    acc: RiskAccumulator,
    attempt: Attempt,
    flagType: string,
    severity: number,
    details: Record<string, unknown>,
  ): void {
    acc.riskScore += severity;
    acc.flags.push({
      userId: attempt.userId,
      attemptId: attempt.id,
      flagType,
      severity,
      details,
    });
    this.logger.debug(
      `Anti-cheat flag added attemptId=${attempt.id} type=${flagType} severity=${severity} totalRisk=${acc.riskScore}`,
    );
  }
}
