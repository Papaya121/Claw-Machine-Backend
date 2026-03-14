import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { getEnvBool, getEnvString } from '../common/env';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { TelegramAuthService } from './telegram-auth.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly devAuthEnabled = getEnvBool('DEV_AUTH_ENABLED', true);
  private readonly devAuthUserPrefix = getEnvString(
    'DEV_AUTH_USER_PREFIX',
    'dev',
  );

  constructor(
    private readonly telegramAuthService: TelegramAuthService,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  authenticateTelegram(initData: string): {
    accessToken: string;
    expiresInSec: number;
    user: { id: string; telegramUserId: string };
  } {
    if (!initData) {
      this.logger.warn('Auth rejected: empty initData');
      throw new BadRequestException('initData is required');
    }

    this.logger.log('Telegram auth request received');
    const parsed = this.telegramAuthService.verifyInitData(initData);
    this.logger.debug(
      `Telegram initData verified for tgUser=${parsed.user.id}`,
    );
    const user = this.usersService.getOrCreateByTelegramUserId(parsed.user.id);
    this.logger.log(
      `User authenticated userId=${user.id} tgUser=${user.telegramUserId}`,
    );

    const token = this.tokenService.issueAccessToken({
      id: user.id,
      telegramUserId: user.telegramUserId,
    });

    this.auditService.log(
      'auth.telegram.success',
      { telegramUserId: user.telegramUserId },
      user.id,
    );

    return {
      accessToken: token.token,
      expiresInSec: token.expiresInSec,
      user: {
        id: user.id,
        telegramUserId: user.telegramUserId,
      },
    };
  }

  authenticateDev(devUserId: string): {
    accessToken: string;
    expiresInSec: number;
    user: { id: string; telegramUserId: string };
  } {
    if (!this.devAuthEnabled) {
      this.logger.warn('Dev auth rejected: DEV_AUTH_ENABLED is false');
      throw new ForbiddenException('Development auth is disabled');
    }

    const normalized = this.normalizeDevUserId(devUserId);
    const telegramUserId = `${this.devAuthUserPrefix}:${normalized}`;
    const user = this.usersService.getOrCreateByTelegramUserId(telegramUserId);
    this.logger.log(
      `Development auth success userId=${user.id} devUserId=${normalized}`,
    );

    const token = this.tokenService.issueAccessToken({
      id: user.id,
      telegramUserId: user.telegramUserId,
    });

    this.auditService.log(
      'auth.dev.success',
      { devUserId: normalized },
      user.id,
    );

    return {
      accessToken: token.token,
      expiresInSec: token.expiresInSec,
      user: {
        id: user.id,
        telegramUserId: user.telegramUserId,
      },
    };
  }

  private normalizeDevUserId(rawValue: string): string {
    const fallback = 'unity-editor';
    const trimmed = (rawValue || '').trim();
    const source = trimmed.length ? trimmed : fallback;

    // Keep id stable and storage-friendly.
    const normalized = source
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);

    return normalized.length ? normalized : fallback;
  }
}
