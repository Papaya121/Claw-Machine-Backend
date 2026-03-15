import { Body, Controller, Get, Logger, Post } from '@nestjs/common';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  @Get('v1/health')
  health() {
    return {
      status: 'ok',
      service: 'claw-machine-backend',
      serverTimeMs: Date.now(),
    };
  }

  @Post('v1/debug/attempt-result')
  attemptResult(@Body() body: Record<string, unknown>) {
    this.logger.log(
      `POST /v1/debug/attempt-result payload=${JSON.stringify(body)}`,
    );
    return {
      status: 'accepted',
      serverTimeMs: Date.now(),
    };
  }
}
