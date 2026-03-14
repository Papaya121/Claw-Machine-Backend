import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { getEnvBool, getEnvString } from '../common/env';
import type { AuthUserContext } from '../common/domain.types';
import type { AuthenticatedRequest } from '../common/http.types';
import { TokenService } from './token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly authDisabled = getEnvBool('AUTH_DISABLED', false);
  private readonly authDisabledUser: AuthUserContext = {
    id: getEnvString('AUTH_DISABLED_USER_ID', 'noauth-user'),
    telegramUserId: getEnvString(
      'AUTH_DISABLED_TELEGRAM_USER_ID',
      'dev:noauth-user',
    ),
  };

  constructor(private readonly tokenService: TokenService) {
    if (this.authDisabled) {
      this.logger.warn(
        `AUTH_DISABLED=true: all protected endpoints allow anonymous access as userId=${this.authDisabledUser.id}`,
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (this.authDisabled) {
      request.authUser = this.authDisabledUser;
      return true;
    }

    const authorization = request.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
      this.logger.warn('Rejected request: missing Bearer token');
      throw new UnauthorizedException('Missing Bearer token');
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      this.logger.warn('Rejected request: empty Bearer token');
      throw new UnauthorizedException('Bearer token is empty');
    }

    request.authUser = this.tokenService.verifyAccessToken(token);
    this.logger.debug(`Authenticated request userId=${request.authUser.id}`);
    return true;
  }
}
