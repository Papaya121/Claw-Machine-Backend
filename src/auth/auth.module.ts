import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TelegramAuthService } from './telegram-auth.service';
import { TokenService } from './token.service';

@Module({
  imports: [UsersModule, AuditModule],
  controllers: [AuthController],
  providers: [AuthService, TelegramAuthService, TokenService, AuthGuard],
  exports: [TokenService, AuthGuard],
})
export class AuthModule {}
