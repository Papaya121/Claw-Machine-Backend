import { Injectable, NotFoundException } from '@nestjs/common';

export interface MachineConfig {
  version: string;
  inputWindowMs: number;
  dtMs: number;
  movement: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    maxSpeed: number;
    acceleration: number;
    damping: number;
  };
  dropTarget: {
    x: number;
    y: number;
  };
  timing: {
    expectedPressMs: number;
    closeWindowMs: number;
  };
  economy: {
    baseWinChance: number;
    minChance: number;
    maxChance: number;
    skillScale: number;
    riskScale: number;
    voidRiskThreshold: number;
  };
}

@Injectable()
export class MachineConfigService {
  private readonly configs = new Map<string, MachineConfig>([
    [
      'v1-default',
      {
        version: 'v1-default',
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
          baseWinChance: 0.16,
          minChance: 0.04,
          maxChance: 0.4,
          skillScale: 0.22,
          riskScale: 0.012,
          voidRiskThreshold: 80,
        },
      },
    ],
  ]);

  get(version: string): MachineConfig {
    const config = this.configs.get(version);
    if (!config) {
      throw new NotFoundException(`Config version ${version} not found`);
    }
    return config;
  }

  getAll(): MachineConfig[] {
    return [...this.configs.values()];
  }
}
