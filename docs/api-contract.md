# Contrato API (`/api/v1`)

OpenAPI interactivo: `http://localhost:3000/api/v1/docs` (Swagger).
Auth: `Authorization: Bearer <supabase_jwt>` en todas las rutas salvo `@Public`.
Errores: `{ error: { code, message, details? }, requestId }`.

| Método | Ruta | Descripción | Guard |
|--------|------|-------------|-------|
| GET | `/health` | Estado del servicio | Público |
| GET | `/auth/me` | Usuario actual (rol, sucursales) | JWT |
| POST | `/sales` | Crear venta (atómica, idempotente por `client_op_id`) | JWT |
| POST | `/sales/:id/cancel` | Cancelar venta | JWT + rol≥supervisor + **PIN** |
| GET | `/sales?sucursal_id=` | Historial de ventas | JWT |
| POST | `/cash/sessions` | Abrir sesión de caja | JWT |
| POST | `/cash/sessions/:id/close` | Cerrar caja (corte) | JWT + **PIN** |
| POST | `/sync/replay` | Reproducir operación offline (idempotente) | JWT |
| GET | `/<modulo>` | Estado del módulo esqueleto | JWT |
| GET | `/<modulo>/list?sucursal_id=` | Lectura RLS de la tabla del módulo | JWT |

Módulos esqueleto: `products, inventory, pricing, transfers, customers,
credit, purchasing, reports, settings, smart`.

Operaciones que **deben** pasar por la API (integridad transaccional):
crear/cancelar venta, abrir/cerrar caja, replay de sync. Lecturas no críticas
(catálogo, historial, dashboards) pueden ir directo a Supabase con RLS.
