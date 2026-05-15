/** Configuración tipada leída de variables de entorno. */
export interface AppEnv {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  jwksUrl: string;
  jwtAud: string;
}

export function loadEnv(): AppEnv {
  const env = process.env;
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: Number(env.API_PORT ?? 3000),
    apiPrefix: env.API_PREFIX ?? 'api',
    apiVersion: env.API_VERSION ?? '1',
    supabaseUrl: env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
    supabaseAnonKey: env.SUPABASE_ANON_KEY ?? '',
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    jwksUrl:
      env.SUPABASE_JWT_JWKS_URL ??
      'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    jwtAud: env.SUPABASE_JWT_AUD ?? 'authenticated',
  };
}

export const ENV = loadEnv();
