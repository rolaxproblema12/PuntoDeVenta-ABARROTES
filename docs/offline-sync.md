# Offline + Sincronización

**Lectura offline:** TanStack Query persiste su caché en IndexedDB
(`lib/queryClient.ts`). Las búsquedas dinámicas no se persisten.

**Escritura offline (ventas):**

1. Al cobrar, el cliente genera `client_op_id` (uuid v7) — clave de idempotencia.
2. **Online** → `POST /api/v1/sales` con header `Idempotency-Key`.
3. **Offline / error 5xx** → la op se encola en IndexedDB (`lib/syncQueue.ts`),
   el ticket se limpia y se muestra "N por sincronizar".
4. Al reconectar (evento `online`) o cada 30 s, `drainQueue()` reenvía cada op
   a `POST /api/v1/sync/replay`.
5. La RPC `replay_sync_op` → `register_sale` deduplica por `client_op_id` en
   `sync_queue` (UNIQUE): un replay repetido devuelve el resultado previo y
   **nunca** duplica la venta ni descuenta stock dos veces.

**Conflictos:** si al reproducir el stock es insuficiente o la sesión de caja
está cerrada, la API responde 409 → la op queda `conflict` y se conserva para
resolución manual en el módulo **Nube / Sync** (Fase 1).

**Garantías:** el folio y el descuento de stock se deciden siempre server-side
dentro de `register_sale` (transacción Postgres atómica).
