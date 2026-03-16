import {
  Body,
  Controller,
  Headers,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../common/http.types';
import { AttemptService } from './attempt.service';

@Controller('v1/attempts')
@UseGuards(AuthGuard)
export class AttemptController {
  private readonly logger = new Logger(AttemptController.name);

  constructor(private readonly attemptService: AttemptService) {}

  @Post('start')
  start(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body()
    body: { machineId?: string; clientBuild?: string; configVersion?: string },
  ) {
    this.logger.log(`POST /v1/attempts/start userId=${req.authUser.id}`);
    return this.attemptService.startAttempt(req.authUser, idempotencyKey, body);
  }

  @Post(':attemptId/inputs')
  inputs(
    @Param('attemptId') attemptId: string,
    @Req() req: AuthenticatedRequest,
    @Headers('x-attempt-token') attemptToken: string | undefined,
    @Body()
    body: {
      packets?: Array<{
        seq: number;
        clientTimeMs: number;
        moveX: number;
        moveY: number;
      }>;
    },
  ) {
    this.logger.log(
      `POST /v1/attempts/${attemptId}/inputs userId=${req.authUser.id}`,
    );
    return this.attemptService.ingestInputs(
      req.authUser,
      attemptId,
      attemptToken,
      body,
    );
  }

  @Post(':attemptId/resolve')
  resolve(
    @Param('attemptId') attemptId: string,
    @Req() req: AuthenticatedRequest,
    @Headers('x-attempt-token') attemptToken: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body()
    body: {
      clientSummary?: {
        pressTimeMs?: number;
        closeStartMs?: number;
        localGrabObserved?: boolean;
        contactHints?: Array<{ toyHintId: string; fingers: number }>;
      };
    },
  ) {
    this.logger.log(
      `POST /v1/attempts/${attemptId}/resolve userId=${req.authUser.id}`,
    );
    return this.attemptService.resolveAttempt(
      req.authUser,
      attemptId,
      attemptToken,
      idempotencyKey,
      body,
    );
  }
}
