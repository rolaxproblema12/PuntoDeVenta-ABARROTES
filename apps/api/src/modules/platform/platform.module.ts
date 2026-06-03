import {
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformOnly } from '../../common/guards/platform-admin.guard';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Injectable()
class PlatformService {
  constructor(private readonly supabase: SupabaseService) {}

  async listTenants() {
    const admin = this.supabase.admin();
    const { data, error } = await admin
      .from('tenants')
      .select('id, name, slug, status, plan_code, trial_ends_at, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  }

  /** Métricas básicas: tenants por estado + MRR estimado (planes activos). */
  async metrics() {
    const admin = this.supabase.admin();
    const [{ data: tenants }, { data: plans }] = await Promise.all([
      admin.from('tenants').select('status, plan_code'),
      admin.from('plans').select('code, price_cents'),
    ]);
    const priceByCode = new Map(
      (plans ?? []).map((p) => [p.code, p.price_cents as number]),
    );
    const byStatus: Record<string, number> = {};
    let mrrCents = 0;
    for (const t of tenants ?? []) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if (t.status === 'active') {
        mrrCents += priceByCode.get(t.plan_code) ?? 0;
      }
    }
    return { total: tenants?.length ?? 0, byStatus, mrrCents };
  }

  async setStatus(tenantId: string, status: string, actorUserId?: string) {
    const admin = this.supabase.admin();
    const { error } = await admin.rpc('set_tenant_status', {
      p_tenant: tenantId,
      p_status: status,
    });
    if (error) throw new Error(error.message);

    // Auditoría (inserción única independiente, no encadenada al RPC):
    // la tabla activity_log admite insert de cualquier usuario activo.
    await admin.from('activity_log').insert({
      user_id: actorUserId ?? null,
      action_key:
        status === 'suspended' ? 'tenant.suspend' : 'tenant.reactivate',
      entity: 'tenant',
      entity_id: tenantId,
      after: { status },
    });

    return { tenant_id: tenantId, status };
  }
}

@ApiTags('platform')
@Controller('platform')
@PlatformOnly()
class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Get('tenants')
  tenants() {
    return this.svc.listTenants();
  }

  @Get('metrics')
  metrics() {
    return this.svc.metrics();
  }

  @Post('tenants/:id/suspend')
  suspend(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.setStatus(id, 'suspended', req.user?.id);
  }

  @Post('tenants/:id/reactivate')
  reactivate(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.setStatus(id, 'active', req.user?.id);
  }
}

@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
