import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/** Cliente Supabase del navegador. Lecturas no críticas y realtime van directo
 * (RLS aplicada). Escrituras críticas pasan por la API NestJS (apiClient). */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
