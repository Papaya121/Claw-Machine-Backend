import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('v1/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('metrics')
  metrics() {
    return this.adminService.metrics();
  }

  @Get('rewards')
  rewards() {
    return this.adminService.listRewards();
  }
}
