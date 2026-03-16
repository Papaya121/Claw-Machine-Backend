import type { MachineConfig } from './machine-config.types';

export interface SpawnPlanRuntimeConfig {
  itemCount: number;
}

export interface RewardRuntimeConfig {
  code: string;
  rarity: number;
  chance: number;
  weight: number;
  isActive: boolean;
  stock: number | null;
}

export interface GameSettingsFile {
  spawnPlan: SpawnPlanRuntimeConfig;
  machines: MachineConfig[];
  rewards: RewardRuntimeConfig[];
}
