import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/http.types';
import { TokenService } from './token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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
