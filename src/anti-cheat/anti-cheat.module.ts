import { Module } from '@nestjs/common';
import { AntiCheatService } from './anti-cheat.service';

@Module({
  providers: [AntiCheatService],
  exports: [AntiCheatService],
})
export class AntiCheatModule {}
