import type { MachineConfig } from './machine-config.types';

export interface SpawnPlanRuntimeConfig {
  itemCount: number;
}

export interface SpawnOnWinToyRuntimeConfig {
  toyId: string;
  weight: number;
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
  spawnOnWinToys?: SpawnOnWinToyRuntimeConfig[] | null;
  machines: MachineConfig[];
  rewards: RewardRuntimeConfig[];
}
