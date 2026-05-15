import type { ApiError } from '@abarrotes/shared';
import { env } from './env';
import { getAccessToken } from './supabase';

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Clave de idempotencia para operaciones que se pueden reintentar offline. */
  idempotencyKey?: string;
  /** PIN para acciones críticas (header X-Pin). */
  pin?: string;
}

/** Wrapper fetch hacia la API NestJS: adjunta el JWT de Supabase + headers. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.pin) headers['X-Pin'] = opts.pin;

  const res = await fetch(`${env.apiUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(
      payload?.error.code ?? 'HTTP_ERROR',
      payload?.error.message ?? res.statusText,
      res.status,
    );
  }
  return (await res.json()) as T;
}
