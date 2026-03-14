import { Module } from '@nestjs/common';
import { MachineConfigService } from './machine-config.service';

@Module({
  providers: [MachineConfigService],
  exports: [MachineConfigService],
})
export class ConfigModule {}
