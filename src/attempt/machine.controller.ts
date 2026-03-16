import {
  Controller,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../common/http.types';
import { AttemptService } from './attempt.service';

@Controller('v1/machines')
@UseGuards(AuthGuard)
export class MachineController {
  private readonly logger = new Logger(MachineController.name);

  constructor(private readonly attemptService: AttemptService) {}

  @Post(':machineId/spawn-plan')
  spawnPlan(
    @Param('machineId') machineId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.log(
      `POST /v1/machines/${machineId}/spawn-plan userId=${req.authUser.id}`,
    );
    return this.attemptService.getMachineSpawnPlan(req.authUser, machineId);
  }
}
