import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AntiCheatModule } from './anti-cheat/anti-cheat.module';
import { AppController } from './app.controller';
import { AttemptModule } from './attempt/attempt.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { RewardModule } from './reward/reward.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    StorageModule,
    ConfigModule,
    UsersModule,
    WalletModule,
    AuditModule,
    AntiCheatModule,
    AuthModule,
    RewardModule,
    AttemptModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
