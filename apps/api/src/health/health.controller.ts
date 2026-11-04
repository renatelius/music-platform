import type { ServerResponse } from 'node:http';

import { Controller, Get, Inject, Res } from '@nestjs/common';

import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /** Liveness: the process is up. No dependency checks. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: 200 when ok or degraded, 503 when a critical dependency is down. */
  @Get()
  async ready(@Res() res: ServerResponse): Promise<void> {
    const report = await this.health.check();
    res.statusCode = report.status === 'down' ? 503 : 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(report));
  }
}
