import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { AuthUserContext } from '../common/domain.types';
import {
  base64UrlDecode,
  base64UrlEncode,
  hmacSha256Hex,
} from '../common/crypto.util';
import { getEnvInt, getEnvString } from '../common/env';

interface AccessTokenPayload {
  sub: string;
  telegramUserId: string;
  iat: number;
  exp: number;
}

interface AttemptTokenPayload {
  userId: string;
  attemptId: string;
  iat: number;
  exp: number;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  private readonly jwtSecret = getEnvString(
    'JWT_SECRET',
    'dev-jwt-secret-change-me',
  );

  private readonly jwtTtlSec = getEnvInt('JWT_TTL_SEC', 60 * 60 * 6);

  private readonly attemptSecret = getEnvString(
    'ATTEMPT_TOKEN_SECRET',
    'dev-attempt-secret-change-me',
  );

  private readonly attemptTtlSec = getEnvInt('ATTEMPT_TTL_SEC', 60 * 5);

  issueAccessToken(user: AuthUserContext): {
    token: string;
    expiresInSec: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const payload: AccessTokenPayload = {
      sub: user.id,
      telegramUserId: user.telegramUserId,
      iat: now,
      exp: now + this.jwtTtlSec,
    };
    this.logger.debug(`Issued access token userId=${user.id}`);
    return {
      token: this.sign('access.v1', payload, this.jwtSecret),
      expiresInSec: this.jwtTtlSec,
    };
  }

  verifyAccessToken(token: string): AuthUserContext {
    const payload = this.verify<AccessTokenPayload>(
      'access.v1',
      token,
      this.jwtSecret,
    );
    return {
      id: payload.sub,
      telegramUserId: payload.telegramUserId,
    };
  }

  issueAttemptToken(userId: string, attemptId: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: AttemptTokenPayload = {
      userId,
      attemptId,
      iat: now,
      exp: now + this.attemptTtlSec,
    };
    const token = this.sign('attempt.v1', payload, this.attemptSecret);
    this.logger.debug(
      `Issued attempt token userId=${userId} attemptId=${attemptId}`,
    );
    return token;
  }

  verifyAttemptToken(token: string, userId: string, attemptId: string): void {
    const payload = this.verify<AttemptTokenPayload>(
      'attempt.v1',
      token,
      this.attemptSecret,
    );
    if (payload.userId !== userId || payload.attemptId !== attemptId) {
      this.logger.warn(
        `Attempt token mismatch expectedUser=${userId} expectedAttempt=${attemptId} actualUser=${payload.userId} actualAttempt=${payload.attemptId}`,
      );
      throw new UnauthorizedException(
        'Attempt token does not match user or attempt',
      );
    }
    this.logger.debug(
      `Attempt token verified userId=${userId} attemptId=${attemptId}`,
    );
  }

  private sign(version: string, payload: object, secret: string): string {
    const versionPart = base64UrlEncode(version);
    const payloadPart = base64UrlEncode(JSON.stringify(payload));
    const signature = hmacSha256Hex(secret, `${versionPart}.${payloadPart}`);
    return `${versionPart}.${payloadPart}.${signature}`;
  }

  private verify<T>(expectedVersion: string, token: string, secret: string): T {
    const parts = token.split('.');
    if (parts.length !== 3) {
      this.logger.warn(
        `Token rejected: malformed token expectedVersion=${expectedVersion}`,
      );
      throw new UnauthorizedException('Malformed token');
    }
    const [versionPart, payloadPart, signaturePart] = parts;

    const expectedSignature = hmacSha256Hex(
      secret,
      `${versionPart}.${payloadPart}`,
    );
    if (expectedSignature !== signaturePart) {
      this.logger.warn(
        `Token rejected: signature mismatch expectedVersion=${expectedVersion}`,
      );
      throw new UnauthorizedException('Token signature mismatch');
    }

    const version = base64UrlDecode(versionPart);
    if (version !== expectedVersion) {
      this.logger.warn(
        `Token rejected: version mismatch expected=${expectedVersion} actual=${version}`,
      );
      throw new UnauthorizedException('Token version mismatch');
    }

    let payload: T & { exp: number };
    try {
      payload = JSON.parse(base64UrlDecode(payloadPart)) as T & { exp: number };
    } catch {
      this.logger.warn(
        `Token rejected: payload parse error expectedVersion=${expectedVersion}`,
      );
      throw new UnauthorizedException('Token payload is invalid');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      this.logger.warn(
        `Token rejected: expired expectedVersion=${expectedVersion}`,
      );
      throw new UnauthorizedException('Token has expired');
    }

    this.logger.debug(`Token verified expectedVersion=${expectedVersion}`);

    return payload;
  }
}
