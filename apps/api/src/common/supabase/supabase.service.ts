import { Injectable } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from '../../config/env';

/**
 * Dos clientes Supabase:
 *  - `admin()`  → service-role. SOLO para invocar RPCs transaccionales
 *                 (register_sale, etc.) que re-validan sucursal/rol en SQL.
 *  - `asUser()` → cliente con el JWT del request (RLS aplicada). Lecturas.
 */
@Injectable()
export class SupabaseService {
  private readonly adminClient: SupabaseClient = createClient(
    ENV.supabaseUrl,
    ENV.supabaseServiceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  admin(): SupabaseClient {
    return this.adminClient;
  }

  asUser(accessToken: string): SupabaseClient {
    return createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}
