import type { QueryClient } from '@tanstack/react-query';

/**
 * Agrupa eventos realtime en una ventana de 300ms para evitar cascadas de
 * invalidación (una venta de 10 ítems dispara ~100 eventos postgres_changes).
 * Portado del patrón del sistema de referencia.
 */
type Bucket = { keys: Set<string>; timer: ReturnType<typeof setTimeout> };

export class RealtimeCoalescer {
  private buckets = new Map<string, Bucket>();
  private readonly windowMs = 300;

  constructor(private readonly qc: QueryClient) {}

  schedule(bucketKey: string, invalidateKeys: string[]): void {
    const existing = this.buckets.get(bucketKey);
    if (existing) {
      invalidateKeys.forEach((k) => existing.keys.add(k));
      return;
    }
    const keys = new Set(invalidateKeys);
    const timer = setTimeout(() => {
      this.buckets.delete(bucketKey);
      keys.forEach((k) =>
        this.qc.invalidateQueries({ queryKey: [k] }),
      );
    }, this.windowMs);
    this.buckets.set(bucketKey, { keys, timer });
  }

  dispose(): void {
    this.buckets.forEach((b) => clearTimeout(b.timer));
    this.buckets.clear();
  }
}
