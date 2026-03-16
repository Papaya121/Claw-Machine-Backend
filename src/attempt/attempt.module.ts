import { Module } from '@nestjs/common';
import { AntiCheatModule } from '../anti-cheat/anti-cheat.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { RewardModule } from '../reward/reward.module';
import { WalletModule } from '../wallet/wallet.module';
import { AttemptController } from './attempt.controller';
import { MachineController } from './machine.controller';
import { AttemptService } from './attempt.service';
import { ReplayResolverService } from './replay-resolver.service';

@Module({
  imports: [
    AuthModule,
    WalletModule,
    ConfigModule,
    AuditModule,
    AntiCheatModule,
    RewardModule,
  ],
  controllers: [AttemptController, MachineController],
  providers: [AttemptService, ReplayResolverService],
})
export class AttemptModule {}
