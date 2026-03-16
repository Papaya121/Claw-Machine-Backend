import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { RewardController } from './reward.controller';
import { RewardService } from './reward.service';

@Module({
  imports: [AuditModule, AuthModule, ConfigModule],
  controllers: [RewardController],
  providers: [RewardService],
  exports: [RewardService],
})
export class RewardModule {}
