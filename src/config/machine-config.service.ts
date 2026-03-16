import { Injectable, NotFoundException } from '@nestjs/common';
import { GameSettingsService } from './game-settings.service';
import type { MachineConfig } from './machine-config.types';

@Injectable()
export class MachineConfigService {
  private readonly configs = new Map<string, MachineConfig>();

  constructor(gameSettings: GameSettingsService) {
    const machines = gameSettings.getMachineConfigs();
    for (const machine of machines) {
      this.configs.set(machine.version, machine);
    }
  }

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
