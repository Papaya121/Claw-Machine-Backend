import type { MachineConfig } from './machine-config.types';

export interface RewardRuntimeConfig {
  code: string;
  rarity: number;
  chance: number;
  isActive: boolean;
  stock: number | null;
}

export interface GameSettingsFile {
  machines: MachineConfig[];
  rewards: RewardRuntimeConfig[];
}
