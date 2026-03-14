import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/http.types';
import { AuthGuard } from '../auth/auth.guard';
import { RewardService } from './reward.service';

@Controller('v1/rewards')
export class RewardController {
  private readonly logger = new Logger(RewardController.name);

  constructor(private readonly rewardService: RewardService) {}

  @UseGuards(AuthGuard)
  @Post('claim')
  async claim(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { attemptId?: string },
  ) {
    if (!idempotencyKey) {
      this.logger.warn('Claim rejected: missing Idempotency-Key');
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (!body.attemptId) {
      this.logger.warn('Claim rejected: missing attemptId');
      throw new BadRequestException('attemptId is required');
    }
    this.logger.log(
      `Claim request userId=${req.authUser.id} attemptId=${body.attemptId}`,
    );

    return this.rewardService.claimReward(
      req.authUser.id,
      body.attemptId,
      idempotencyKey,
    );
  }
}
