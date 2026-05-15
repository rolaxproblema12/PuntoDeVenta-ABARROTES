import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';

@ApiTags('health')
@Controller('health')
class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', service: 'abarrotes-api', ts: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
