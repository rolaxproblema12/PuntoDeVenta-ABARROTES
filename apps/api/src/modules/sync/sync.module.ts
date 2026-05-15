import { Body, Controller, Module, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SupabaseService } from '../../common/supabase/supabase.service';

interface ReplayBody {
  op_type: 'sale.create' | 'sale.cancel' | 'return.create';
  payload: unknown;
}

@ApiTags('sync')
@Controller('sync')
class SyncController {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Reproduce una operación encolada offline. Idempotente: la RPC
   * `replay_sync_op` deduplica por client_op_id en `sync_queue`.
   */
  @Post('replay')
  async replay(@Req() req: any, @Body() body: ReplayBody) {
    const { data, error } = await this.supabase
      .asUser(req.accessToken)
      .rpc('replay_sync_op', { p_payload: body });
    if (error) throw new Error(error.message);
    return data;
  }
}

@Module({ controllers: [SyncController] })
export class SyncModule {}
