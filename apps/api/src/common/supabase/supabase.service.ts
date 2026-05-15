import { Injectable } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from '../../config/env';

/**
 * Dos clientes Supabase:
 *  - `admin()`  → service-role. SOLO para invocar RPCs transaccionales
 *                 (register_sale, etc.) que re-validan sucursal/rol en SQL.
 *  - `asUser()` → cliente con el JWT del request (RLS aplicada). Lecturas.
 *
 * Construcción perezosa: la app arranca (y `/health` responde) aunque las
 * llaves de Supabase no estén configuradas todavía.
 */
@Injectable()
export class SupabaseService {
  private adminClient: SupabaseClient | null = null;

  admin(): SupabaseClient {
    if (!this.adminClient) {
      if (!ENV.supabaseServiceRoleKey) {
        throw new Error(
          'SUPABASE_SERVICE_ROLE_KEY ausente: configura .env.local',
        );
      }
      this.adminClient = createClient(
        ENV.supabaseUrl,
        ENV.supabaseServiceRoleKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    }
    return this.adminClient;
  }

  asUser(accessToken: string): SupabaseClient {
    if (!ENV.supabaseAnonKey) {
      throw new Error('SUPABASE_ANON_KEY ausente: configura .env.local');
    }
    return createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}
