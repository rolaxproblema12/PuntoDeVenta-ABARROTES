# Esquema de Base de Datos

Migraciones en `supabase/migrations/` (numeradas, idempotentes). **Nunca editar
una aplicada** — agregar una nueva.

| Migración | Contenido |
|-----------|-----------|
| 0001_init | extensiones, `sucursales`, `profiles`, `user_sucursales`, `permissions`, `access_codes`, helpers RLS (`is_admin`, `is_active_user_in_sucursal`), alta auto de profile |
| 0002_catalog | `categories` (jerárquicas), `brands`, `suppliers`, `products`, `product_barcodes`, `product_variants`, `unit_conversions`; helper `apply_sucursal_rls` |
| 0003_pricing | `price_lists`, `product_prices` (tiers), `promotions`, `promotion_targets`, `combos`, `combo_items` |
| 0004_inventory | `lots`, `branch_stock`, `inventory_movements` (+trigger delta `FOR UPDATE` y guarda de stock negativo), `transfers`, `transfer_items` |
| 0005_cash_sales | `sucursal_counters` + `next_folio`, `registers`, `cash_sessions` (1 abierta/caja), `sales`, `sale_items`, `sale_payments`, `suspended_sales`, `returns`, `return_items` |
| 0006_customers_credit | `customers`, `customer_credit_movements` (+trigger saldo), `loyalty_accounts`, `loyalty_movements` |
| 0007_purchasing | `purchase_orders`, `po_items`, `goods_receipts`, `goods_receipt_items`, `accounts_payable` |
| 0008_security_audit | `activity_log`, `verify_pin`, `set_pin` |
| 0009_settings_sync | `settings`, `sync_queue` (idempotencia offline), `ai_signals` (esqueleto IA) |
| 0010_rpcs | `fifo_consume_lots`, `assert_credit_available`, `apply_promotions` (stub), **`register_sale`** (venta atómica idempotente), `replay_sync_op` |
| 0011_report_views | vistas `v_low_stock`, `v_expiring_lots`, `v_sales_daily`, `v_top_products`, `v_kardex` (security_invoker) |
| 0012_indexes | índices trigram de búsqueda + consultas frecuentes |
| 0013_seed_helpers | `seed_default_permissions()` + matriz de permisos por rol |

Convenciones: `sucursal_id` en toda tabla transaccional; RLS con
`is_active_user_in_sucursal(sucursal_id)`; montos en **centavos** (`bigint`);
folios `<CODE>-<NNNN>` por sucursal vía `next_folio`.
