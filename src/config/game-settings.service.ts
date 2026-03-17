import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { getEnvString } from '../common/env';
import type {
  GameSettingsFile,
  RewardRuntimeConfig,
  SpawnPlanRuntimeConfig,
  SpawnOnWinToyRuntimeConfig,
} from './game-settings.types';
import type { MachineConfig } from './machine-config.types';

@Injectable()
export class GameSettingsService {
  private readonly logger = new Logger(GameSettingsService.name);
  private readonly settingsPath: string;
  private readonly settings: GameSettingsFile;

  constructor() {
    const configuredPath = getEnvString(
      'GAME_SETTINGS_PATH',
      'config/game-settings.json',
    ).trim();

    this.settingsPath = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(process.cwd(), configuredPath);

    this.settings = this.loadSettings(this.settingsPath);
  }

  getMachineConfigs(): MachineConfig[] {
    return this.settings.machines.map((machine) => ({
      ...machine,
      movement: { ...machine.movement },
      dropTarget: { ...machine.dropTarget },
      timing: { ...machine.timing },
      economy: { ...machine.economy },
    }));
  }

  getRewardConfigs(): RewardRuntimeConfig[] {
    return this.settings.rewards.map((reward) => ({ ...reward }));
  }

  getSpawnPlanConfig(): SpawnPlanRuntimeConfig {
    return { ...this.settings.spawnPlan };
  }

  getSpawnOnWinToyConfigs(): SpawnOnWinToyRuntimeConfig[] {
    return (this.settings.spawnOnWinToys ?? []).map((candidate) => ({
      ...candidate,
    }));
  }

  private loadSettings(pathToFile: string): GameSettingsFile {
    let raw: string;
    try {
      raw = readFileSync(pathToFile, 'utf8');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      throw new InternalServerErrorException(
        `Failed to read game settings file '${pathToFile}': ${message}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? 'unknown');
      throw new InternalServerErrorException(
        `Failed to parse game settings JSON '${pathToFile}': ${message}`,
      );
    }

    const settings = this.validateSettings(parsed);
    this.logger.log(
      `Game settings loaded from '${pathToFile}'. machines=${settings.machines.length} rewards=${settings.rewards.length}`,
    );
    return settings;
  }

  private validateSettings(value: unknown): GameSettingsFile {
    if (!value || typeof value !== 'object') {
      throw new InternalServerErrorException(
        'Game settings JSON root must be an object.',
      );
    }

    const candidate = value as Partial<GameSettingsFile>;
    const spawnPlan = candidate.spawnPlan;
    const spawnOnWinToys = candidate.spawnOnWinToys;
    const machines = candidate.machines;
    const rewards = candidate.rewards;

    this.validateSpawnPlan(spawnPlan);
    this.validateSpawnOnWinToys('root', spawnOnWinToys);

    if (!Array.isArray(machines) || machines.length === 0) {
      throw new InternalServerErrorException(
        'Game settings must include non-empty "machines" array.',
      );
    }

    if (!Array.isArray(rewards) || rewards.length === 0) {
      throw new InternalServerErrorException(
        'Game settings must include non-empty "rewards" array.',
      );
    }

    for (const machine of machines) {
      this.validateMachine(machine);
    }

    for (const reward of rewards) {
      this.validateReward(reward);
    }

    const normalizedSpawnPlan = spawnPlan as SpawnPlanRuntimeConfig;
    const normalizedMachines = machines;
    const normalizedRewards = rewards;

    return {
      spawnPlan: normalizedSpawnPlan,
      spawnOnWinToys:
        (spawnOnWinToys as SpawnOnWinToyRuntimeConfig[] | null | undefined) ??
        [],
      machines: normalizedMachines,
      rewards: normalizedRewards,
    };
  }

  private validateSpawnPlan(spawnPlan: unknown): void {
    if (!spawnPlan || typeof spawnPlan !== 'object') {
      throw new InternalServerErrorException(
        'Game settings must include "spawnPlan" object.',
      );
    }

    const value = spawnPlan as Partial<SpawnPlanRuntimeConfig>;
    if (
      !Number.isInteger(value.itemCount) ||
      (value.itemCount ?? 0) < 1 ||
      (value.itemCount ?? 0) > 200
    ) {
      throw new InternalServerErrorException(
        'spawnPlan.itemCount must be an integer in range 1..200.',
      );
    }
  }

  private validateMachine(machine: unknown): void {
    if (!machine || typeof machine !== 'object') {
      throw new InternalServerErrorException(
        'Each machine config entry must be an object.',
      );
    }

    const value = machine as Partial<MachineConfig>;
    if (!value.version || typeof value.version !== 'string') {
      throw new InternalServerErrorException(
        'Machine config entry must include string "version".',
      );
    }

    const inputWindowMs = value.inputWindowMs;
    if (!Number.isFinite(inputWindowMs) || (inputWindowMs ?? 0) <= 0) {
      throw new InternalServerErrorException(
        `Machine '${value.version}' has invalid inputWindowMs.`,
      );
    }

    const dtMs = value.dtMs;
    if (!Number.isFinite(dtMs) || (dtMs ?? 0) <= 0) {
      throw new InternalServerErrorException(
        `Machine '${value.version}' has invalid dtMs.`,
      );
    }
  }

  private validateReward(reward: unknown): void {
    if (!reward || typeof reward !== 'object') {
      throw new InternalServerErrorException(
        'Each reward config entry must be an object.',
      );
    }

    const value = reward as Partial<RewardRuntimeConfig>;
    if (!value.code || typeof value.code !== 'string') {
      throw new InternalServerErrorException(
        'Reward config entry must include string "code".',
      );
    }

    if (
      !Number.isFinite(value.rarity) ||
      (value.rarity ?? 0) < 0 ||
      (value.rarity ?? 0) > 1
    ) {
      throw new InternalServerErrorException(
        `Reward '${value.code}' has invalid rarity.`,
      );
    }

    if (
      !Number.isFinite(value.chance) ||
      (value.chance ?? 0) < 0 ||
      (value.chance ?? 0) > 1
    ) {
      throw new InternalServerErrorException(
        `Reward '${value.code}' has invalid chance.`,
      );
    }

    if (!Number.isFinite(value.weight) || (value.weight ?? 0) < 0) {
      throw new InternalServerErrorException(
        `Reward '${value.code}' has invalid weight.`,
      );
    }

    if (typeof value.isActive !== 'boolean') {
      throw new InternalServerErrorException(
        `Reward '${value.code}' has invalid isActive flag.`,
      );
    }

    if (
      value.stock !== null &&
      (!Number.isInteger(value.stock) || (value.stock ?? 0) < 0)
    ) {
      throw new InternalServerErrorException(
        `Reward '${value.code}' has invalid stock value.`,
      );
    }

  }

  private validateSpawnOnWinToys(
    rewardCode: string | undefined,
    spawnOnWinToys: unknown,
  ): void {
    if (spawnOnWinToys === undefined || spawnOnWinToys === null) {
      return;
    }

    if (!Array.isArray(spawnOnWinToys)) {
      throw new InternalServerErrorException(
        `Reward '${rewardCode}' has invalid spawnOnWinToys value.`,
      );
    }

    for (const candidate of spawnOnWinToys) {
      if (!candidate || typeof candidate !== 'object') {
        throw new InternalServerErrorException(
          `Reward '${rewardCode}' has invalid spawnOnWinToys entry.`,
        );
      }

      const value = candidate as Partial<SpawnOnWinToyRuntimeConfig>;
      if (!value.toyId || typeof value.toyId !== 'string') {
        throw new InternalServerErrorException(
          `Reward '${rewardCode}' has spawnOnWinToys entry without valid toyId.`,
        );
      }

      if (!Number.isFinite(value.weight) || (value.weight ?? 0) < 0) {
        throw new InternalServerErrorException(
          `Reward '${rewardCode}' has spawnOnWinToys entry with invalid weight.`,
        );
      }
    }
  }
}
