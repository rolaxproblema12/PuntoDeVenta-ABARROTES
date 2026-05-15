import { get, set } from 'idb-keyval';
import type { CreateSaleInput, SyncOpType } from '@abarrotes/shared';
import { api, ApiRequestError } from './apiClient';

export interface SyncOp {
  clientOpId: string;
  type: SyncOpType;
  payload: CreateSaleInput | Record<string, unknown>;
  createdAt: string;
  status: 'pending' | 'applied' | 'conflict' | 'failed';
  error?: string;
}

const KEY = 'abarrotes-sync-queue';
type Listener = (ops: SyncOp[]) => void;
const listeners = new Set<Listener>();

async function readQueue(): Promise<SyncOp[]> {
  return (await get<SyncOp[]>(KEY)) ?? [];
}

async function writeQueue(ops: SyncOp[]): Promise<void> {
  await set(KEY, ops);
  listeners.forEach((l) => l(ops));
}

export function subscribeQueue(l: Listener): () => void {
  listeners.add(l);
  void readQueue().then(l);
  return () => listeners.delete(l);
}

/** Encola una operación (la idempotencia la garantiza clientOpId server-side). */
export async function enqueueOp(
  op: Omit<SyncOp, 'status' | 'createdAt'>,
): Promise<void> {
  const ops = await readQueue();
  ops.push({ ...op, status: 'pending', createdAt: new Date().toISOString() });
  await writeQueue(ops);
}

/**
 * Drena la cola FIFO contra la API. La RPC `replay_sync_op` deduplica por
 * clientOpId → reintentar nunca duplica la venta. Conflictos (stock/sesión)
 * se marcan para resolución manual en el panel Nube.
 */
export async function drainQueue(): Promise<void> {
  if (!navigator.onLine) return;
  const ops = await readQueue();
  let mutated = false;

  for (const op of ops) {
    if (op.status === 'applied') continue;
    try {
      await api('/sync/replay', {
        method: 'POST',
        body: { op_type: op.type, payload: op.payload },
        idempotencyKey: op.clientOpId,
      });
      op.status = 'applied';
      mutated = true;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
        op.status = 'conflict';
        op.error = e.message;
      } else {
        op.status = 'failed';
        op.error = (e as Error).message;
      }
      mutated = true;
    }
  }

  if (mutated) {
    // Conserva conflicts/failed para revisión; descarta applied antiguos.
    await writeQueue(ops.filter((o) => o.status !== 'applied'));
  }
}

/** Registra el auto-drenado al recuperar conexión. */
export function installSyncListeners(): void {
  window.addEventListener('online', () => void drainQueue());
  setInterval(() => void drainQueue(), 30_000);
}
