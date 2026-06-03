import {
  Controller,
  DynamicModule,
  Get,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SupabaseService } from './supabase/supabase.service';

/**
 * Fábrica de módulos esqueleto (Fase 0). Cada uno expone:
 *  - GET /<base>           → estado del módulo (placeholder)
 *  - GET /<base>/list      → lectura RLS de su tabla principal (si aplica)
 * La lógica funcional se implementa por fase. Ver CLAUDE.md.
 */
export function createSkeletonModule(
  base: string,
  table: string | null,
): DynamicModule {
  @ApiTags(base)
  @Controller(base)
  class SkeletonController {
    constructor(readonly supabase: SupabaseService) {}

    @Get()
    status() {
      return { module: base, status: 'skeleton', phase: 0, table };
    }

    @Get('list')
    async list(
      @Req() req: any,
      @Query('sucursal_id', new ParseUUIDPipe({ version: '4', optional: true }))
      sucursalId?: string,
    ) {
      if (!table) return { module: base, status: 'skeleton' };
      let q = this.supabase.asUser(req.accessToken).from(table).select('*').limit(100);
      if (sucursalId) q = q.eq('sucursal_id', sucursalId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data;
    }
  }

  const moduleClass = class {};
  Object.defineProperty(moduleClass, 'name', {
    value: `${base[0]!.toUpperCase()}${base.slice(1)}Module`,
  });

  return {
    module: moduleClass,
    controllers: [SkeletonController],
  };
}
