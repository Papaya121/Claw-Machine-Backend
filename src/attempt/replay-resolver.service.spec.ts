import { ReplayResolverService } from './replay-resolver.service';
import type { MachineConfig } from '../config/machine-config.types';

describe('ReplayResolverService.resolveOutcome', () => {
  const resolver = new ReplayResolverService();

  const config: MachineConfig = {
    version: 'test',
    inputWindowMs: 12000,
    dtMs: 20,
    movement: {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
      maxSpeed: 1.6,
      acceleration: 6.5,
      damping: 3.2,
    },
    dropTarget: {
      x: 0,
      y: 0,
    },
    timing: {
      expectedPressMs: 3600,
      closeWindowMs: 700,
    },
    economy: {
      baseWinChance: 1,
      minChance: 0,
      maxChance: 1,
      skillScale: 0,
      riskScale: 0,
      voidRiskThreshold: 80,
      dropAfterGrabChance: 0,
      grabValidationMinAlignment: 0.35,
      grabValidationMinSkill: 0.25,
    },
  };

  const replay = {
    dropAlignment: 0.9,
    stability: 0.8,
    timingQuality: 0.8,
    lockedPhaseMovement: false,
    repeatedPrecisionBin: 0,
    skillScore: 0.8,
    lastPosition: { x: 0, y: 0 },
  };

  it('returns win when grab is validated and chance check passes', () => {
    const outcome = resolver.resolveOutcome(config, replay, 'seed-a', 0, {
      localGrabObserved: true,
      serverValidatedGrab: true,
    });

    expect(outcome.result).toBe('win');
    expect(outcome.outcomeReason).toBe('win');
  });

  it('returns lose when grab is not validated even with high chance', () => {
    const outcome = resolver.resolveOutcome(config, replay, 'seed-b', 0, {
      localGrabObserved: true,
      serverValidatedGrab: false,
    });

    expect(outcome.result).toBe('lose');
    expect(outcome.outcomeReason).toBe('grab_not_validated');
  });
});
