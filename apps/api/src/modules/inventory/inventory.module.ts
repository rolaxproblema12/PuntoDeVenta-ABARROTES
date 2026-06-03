import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { stockMovementSchema, type StockMovementInput } from '@abarrotes/shared';
import { Roles, RequirePin } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SupabaseService } from '../../common/supabase/supabase.service';

/**
 * Escrituras de inventario. Toda la mutación multi-tabla (lote + movimiento +
 * stock) ocurre en la RPC atómica `record_stock_movement`, invocada con el JWT
 * del usuario (auth.uid() resuelve los chequeos RLS internos).
 */
@Injectable()
class InventoryService {
  constructor(private readonly supabase: SupabaseService) {}

  async record(token: string, input: StockMovementInput) {
    const { data, error } = await this.supabase
      .asUser(token)
      .rpc('record_stock_movement', { p_payload: input });
    if (error) throw new Error(error.message);
    return data;
  }

  async movements(token: string, sucursalId: string, productId?: string) {
    let q = this.supabase
      .asUser(token)
      .from('inventory_movements')
      .select('id, created_at, kind, quantity, unit_cost, ref_type, product_id')
      .eq('sucursal_id', sucursalId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (productId) q = q.eq('product_id', productId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  }
}

@ApiTags('inventory')
@Controller('inventory')
class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** Entrada de mercancía: crea lote (FIFO) y captura costo/caducidad. */
  @Post('entry')
  @Roles('encargado')
  entry(
    @Req() req: any,
    @Body(new ZodValidationPipe(stockMovementSchema)) body: StockMovementInput,
  ) {
    if (body.kind !== 'entrada') {
      throw new BadRequestException('Esta ruta solo acepta entradas.');
    }
    return this.inventory.record(req.accessToken, body);
  }

  /** Ajuste a conteo físico, salida o merma — requieren PIN. */
  @Post('adjust')
  @Roles('encargado')
  @RequirePin('inventory.adjust')
  adjust(
    @Req() req: any,
    @Body(new ZodValidationPipe(stockMovementSchema)) body: StockMovementInput,
  ) {
    if (!['ajuste', 'salida', 'merma'].includes(body.kind)) {
      throw new BadRequestException('Esta ruta acepta ajuste, salida o merma.');
    }
    return this.inventory.record(req.accessToken, body);
  }

  /** Kardex / historial de movimientos (lectura RLS). */
  @Get('movements')
  list(
    @Req() req: any,
    @Query('sucursal_id', new ParseUUIDPipe({ version: '4' }))
    sucursalId: string,
    @Query('product_id', new ParseUUIDPipe({ version: '4', optional: true }))
    productId?: string,
  ) {
    return this.inventory.movements(req.accessToken, sucursalId, productId);
  }
}

@Module({ controllers: [InventoryController], providers: [InventoryService] })
export class InventoryModule {}
