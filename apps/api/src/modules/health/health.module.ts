import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { SupabaseService } from '../../common/supabase/supabase.service';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Public()
  @Get()
  async check() {
    const base = {
      service: 'abarrotes-api',
      ts: new Date().toISOString(),
    };
    try {
      // Sonda ligera: HEAD count sobre una tabla pública de catálogo.
      const { error } = await this.supabase
        .admin()
        .from('plans')
        .select('code', { head: true, count: 'exact' })
        .limit(1);
      if (error) {
        return { status: 'degraded', db: false, ...base };
      }
      return { status: 'ok', db: true, ...base };
    } catch {
      return { status: 'degraded', db: false, ...base };
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
