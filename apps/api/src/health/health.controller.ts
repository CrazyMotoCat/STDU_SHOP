import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { READINESS_PROBE, type ReadinessProbe } from './dependencies.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(READINESS_PROBE) private readonly probe: ReadinessProbe,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' as const };
  }

  @Get('ready')
  async ready() {
    const checks = await this.probe.check();
    if (checks.postgres !== 'up' || checks.redis !== 'up') {
      throw new ServiceUnavailableException({ status: 'not_ready', checks });
    }
    return { status: 'ready' as const, checks };
  }
}
