import { Body, Controller, Logger, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('v1/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('telegram')
  telegram(@Body() body: { initData?: string }) {
    this.logger.log('POST /v1/auth/telegram');
    return this.authService.authenticateTelegram(body.initData || '');
  }

  @Post('dev')
  dev(@Body() body: { devUserId?: string }) {
    this.logger.log('POST /v1/auth/dev');
    return this.authService.authenticateDev(body.devUserId || '');
  }
}
