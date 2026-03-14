import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { hmacSha256Buffer, hmacSha256Hex } from '../common/crypto.util';
import { getEnvInt, getEnvString } from '../common/env';

interface ParsedInitData {
  authDate: number;
  user: { id: string };
}

@Injectable()
export class TelegramAuthService {
  private readonly logger = new Logger(TelegramAuthService.name);

  private readonly botToken = getEnvString(
    'TELEGRAM_BOT_TOKEN',
    'dev-bot-token',
  );

  private readonly ttlSec = getEnvInt('TELEGRAM_INIT_DATA_TTL_SEC', 120);

  verifyInitData(initData: string): ParsedInitData {
    this.logger.debug('Telegram initData verification started');
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');

    if (!hash) {
      this.logger.warn('Telegram auth rejected: hash missing');
      throw new UnauthorizedException('Telegram initData hash is missing');
    }

    const dataCheckPairs: string[] = [];
    for (const [key, value] of params.entries()) {
      if (key !== 'hash') {
        dataCheckPairs.push(`${key}=${value}`);
      }
    }
    dataCheckPairs.sort((a, b) => a.localeCompare(b));

    const secret = hmacSha256Buffer('WebAppData', this.botToken);
    const dataCheckString = dataCheckPairs.join('\n');
    const calculatedHash = hmacSha256Hex(secret, dataCheckString);

    if (calculatedHash !== hash) {
      this.logger.warn('Telegram auth rejected: signature mismatch');
      throw new UnauthorizedException('Telegram initData signature mismatch');
    }

    const authDateRaw = params.get('auth_date');
    if (!authDateRaw) {
      this.logger.warn('Telegram auth rejected: auth_date missing');
      throw new UnauthorizedException('auth_date is missing');
    }

    const authDate = Number.parseInt(authDateRaw, 10);
    if (!Number.isFinite(authDate)) {
      this.logger.warn('Telegram auth rejected: auth_date invalid');
      throw new UnauthorizedException('auth_date is invalid');
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - authDate) > this.ttlSec) {
      this.logger.warn(
        `Telegram auth rejected: auth_date expired authDate=${authDate}`,
      );
      throw new UnauthorizedException('Telegram initData is too old');
    }

    const userRaw = params.get('user');
    if (!userRaw) {
      this.logger.warn('Telegram auth rejected: user payload missing');
      throw new UnauthorizedException('user payload is missing');
    }

    let user: { id: string | number };
    try {
      user = JSON.parse(userRaw) as { id: string | number };
    } catch {
      this.logger.warn('Telegram auth rejected: user payload JSON invalid');
      throw new UnauthorizedException('user payload is invalid JSON');
    }

    if (!user.id) {
      this.logger.warn('Telegram auth rejected: user.id missing');
      throw new UnauthorizedException('user.id is missing');
    }

    this.logger.debug(`Telegram initData verified tgUser=${String(user.id)}`);

    return {
      authDate,
      user: {
        id: String(user.id),
      },
    };
  }
}
