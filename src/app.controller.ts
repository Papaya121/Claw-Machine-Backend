import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('v1/health')
  health() {
    return {
      status: 'ok',
      service: 'claw-machine-backend',
      serverTimeMs: Date.now(),
    };
  }
}
