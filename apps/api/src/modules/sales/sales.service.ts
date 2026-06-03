import { Injectable } from '@nestjs/common';
import type { CreateSaleInput } from '@abarrotes/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';

/**
 * Punto de entrada transaccional de ventas. Toda la escritura ocurre dentro
 * de la función SQL `register_sale` (atómica + idempotente por client_op_id).
 * Se invoca con el JWT del usuario: auth.uid() se resuelve para los chequeos
 * RLS internos, y la función (SECURITY DEFINER) realiza la escritura atómica.
 */
@Injectable()
export class SalesService {
  constructor(private readonly supabase: SupabaseService) {}

  async createSale(accessToken: string, payload: CreateSaleInput) {
    const { data, error } = await this.supabase
      .asUser(accessToken)
      .rpc('register_sale', { p_payload: payload });
    if (error) throw new Error(error.message);
    return data;
  }

  async cancelSale(accessToken: string, saleId: string, reason: string) {
    // RPC atómica: marca cancelada + reingresa inventario/lotes + abona el cargo
    // de crédito, todo en una transacción e idempotente (ver cancel_sale en
    // supabase/migrations/0025_accounting_hardening.sql).
    const { data, error } = await this.supabase
      .asUser(accessToken)
      .rpc('cancel_sale', { p_sale_id: saleId, p_reason: reason });
    if (error) throw new Error(error.message);
    return data;
  }

  async listSales(accessToken: string, sucursalId: string) {
    const { data, error } = await this.supabase
      .asUser(accessToken)
      .from('sales')
      .select('id, folio, total, status, payment_method, created_at')
      .eq('sucursal_id', sucursalId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data;
  }
}
