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
    const { data, error } = await this.supabase
      .asUser(accessToken)
      .from('sales')
      .update({
        status: 'cancelada',
        cancelled_at: new Date().toISOString(),
        cancelled_reason: reason,
      })
      .eq('id', saleId)
      .select('id, status')
      .single();
    if (error) throw new Error(error.message);
    // NOTA: la reversa de stock se moverá a una RPC dedicada en Fase 1.
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
