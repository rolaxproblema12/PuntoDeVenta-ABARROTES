import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carga .env.local / .env desde la RAÍZ del monorepo (no desde apps/api),
 * sin depender de @nestjs/config (evita problemas de orden de import).
 * No sobreescribe variables ya presentes en el entorno real.
 */
function loadDotenv(): void {
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env.local'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../../.env.local'),
    resolve(__dirname, '../../../../.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

loadDotenv();

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
  appPublicUrl: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripePrices: Record<string, string>;
  corsOrigins: string[];
  throttleTtlMs: number;
  throttleLimit: number;
}

export function loadEnv(): AppEnv {
  const env = process.env;
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    // Render/Railway/Fly inyectan el puerto en PORT; respétalo. API_PORT es el
    // fallback local.
    port: Number(env.PORT ?? env.API_PORT ?? 3000),
    apiPrefix: env.API_PREFIX ?? 'api',
    apiVersion: env.API_VERSION ?? '1',
    supabaseUrl: env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
    supabaseAnonKey: env.SUPABASE_ANON_KEY ?? '',
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    jwksUrl:
      env.SUPABASE_JWT_JWKS_URL ??
      'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
    jwtAud: env.SUPABASE_JWT_AUD ?? 'authenticated',
    appPublicUrl: env.APP_PUBLIC_URL ?? 'http://localhost:5173',
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    stripePrices: {
      basico: env.STRIPE_PRICE_BASICO ?? '',
      pro: env.STRIPE_PRICE_PRO ?? '',
      negocio: env.STRIPE_PRICE_NEGOCIO ?? '',
    },
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    throttleTtlMs: Number(env.THROTTLE_TTL_MS ?? 60000),
    throttleLimit: Number(env.THROTTLE_LIMIT ?? 120),
  };
}

export const ENV = loadEnv();
