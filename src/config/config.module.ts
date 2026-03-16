import { Module } from '@nestjs/common';
import { GameSettingsService } from './game-settings.service';
import { MachineConfigService } from './machine-config.service';

@Module({
  providers: [GameSettingsService, MachineConfigService],
  exports: [GameSettingsService, MachineConfigService],
})
export class ConfigModule {}
