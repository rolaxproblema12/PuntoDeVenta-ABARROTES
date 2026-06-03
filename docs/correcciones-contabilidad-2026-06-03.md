# Correcciones contables aplicadas — 2026-06-03

Implementación de los hallazgos de `auditoria-contabilidad-2026-06-03.md` (P0–P3) y
de la revisión adversarial posterior. Modelo de precios: **IVA incluido**; dinero en
centavos (bigint); escritura multi-tabla siempre dentro de una RPC atómica.

## Migraciones nuevas (no se editaron migraciones aplicadas)

- **0024_fix_register_sale_iva.sql** — corrige la doble aplicación de IVA (el bug
  original: $50 cobraba $58). El IVA se extrae como porción contenida.
- **0025_accounting_hardening.sql**
  - `register_sale` endurecida: advisory lock anti doble-venta concurrente; COGS
    server-side (`branch_stock.avg_cost`, ignora el `unit_cost` del cliente);
    crédito = solo el residuo no cubierto, con `FOR UPDATE` del cliente y
    revalidación del límite; rechaza `method='mixto'` por línea; valida
    `discount ≤ unit_price` y `total > 0`; vuelto solo sobre efectivo.
  - `cancel_sale` — cancelación atómica: reingresa inventario/lotes y abona el
    cargo de crédito. Idempotente.
  - `register_credit_payment` — abono manual con tope (`amount ≤ saldo`).
- **0026_purchasing_returns.sql**
  - `receive_goods` — recepción atómica: lote + entrada (exige `unit_cost > 0`) y
    genera la cuenta por pagar si es a crédito.
  - `register_return` — devolución con reembolso proporcional e IVA contenido,
    reingreso de stock, abono/efectivo, parciales, idempotente.
  - `replay_sync_op` despacha `sale.create` / `sale.cancel` / `return.create`.
  - `v_sales_daily` / `v_top_products` netean devoluciones.
- **0027_accounting_fixes.sql** (correcciones de la revisión adversarial)
  - `cancel_sale`: rechaza cancelar ventas **con devoluciones** (evitaba doble
    reingreso de stock y doble reversa de crédito) y ventas cuya **sesión de caja
    ya cerró** (corte Z congelado); reingresa al **costo histórico** de la línea.
  - `register_return`: reingreso al costo histórico de la línea.
  - `receive_goods`: ahora **idempotente** por `client_op_id` (advisory lock +
    `sync_queue`); se amplió el CHECK de `sync_queue.op_type` con `purchase.receive`.
  - `register_supplier_payment` — paga (parcial/total) una cuenta por pagar.
  - `cash_session_summary`: incluye ventas `'devuelta'` en el efectivo recibido
    (evita la doble resta del reembolso en efectivo).
  - vistas: el neteo excluye devoluciones de ventas canceladas; `v_top_products`
    excluye cantidad neta ≤ 0.
- **0028_receipts_and_netting.sql** (cierra los 2 hallazgos restantes)
  - `goods_receipts`: `po_id` ahora nullable + columna `supplier_id`. `receive_goods`
    crea un **encabezado de recepción** con proveedor + líneas (`goods_receipt_items`)
    y los movimientos apuntan al recibo (`ref_id`), también en compras de contado. [#10]
  - `v_sales_daily`: el reembolso se imputa al **día de la venta original** (sin
    barras negativas en días sin ventas) y se corrige un **sobreconteo** (se suma por
    ítem `ri.refund_amount`, no `sum(returns.total)` que se multiplicaba al unir con
    `return_items`). [#13]

## Cambios web / shared / api

- `packages/shared`: `PAYMENT_LINE_METHODS` (sin `mixto`); `saleItemInputSchema`
  valida `discount ≤ unit_price`; `createSaleSchema` valida `total > 0`;
  `SYNC_OP_TYPES` incluye `purchase.receive`.
- `apps/api/.../sales.service.ts`: `cancelSale` llama la RPC `cancel_sale`.
- `apps/web` POS: línea del ticket usa `lineTotalCents` (con descuento).
- `apps/web` Clientes: abono vía `register_credit_payment` + tope en UI.
- `apps/web` Compras: recepción vía `receive_goods` (proveedor + a crédito,
  `client_op_id`); botón **Pagar** de cuentas por pagar vía `register_supplier_payment`.
- `apps/web` Reportes: KPIs desde `v_sales_daily` (neteada); export del libro
  excluye canceladas y devueltas; top de productos neteado por devoluciones.

## Limitaciones conocidas

- **UI de devoluciones pendiente.** El backend (`register_return`) está completo y
  es invocable vía `POST /sync/replay` con `op_type:'return.create'` y payload
  `createReturnSchema`. Falta una pantalla para capturarlas.
  (Los hallazgos #10 —proveedor en compras de contado— y #13 —imputación del
  reembolso al día de la venta— quedaron corregidos en 0028.)

## Verificación

- `pnpm test` (35 tests), `pnpm typecheck`, `pnpm db:bundle` — OK.
- Falta aplicar a la base: `pnpm db:push` o aplicar `supabase/all-in-one.sql`.
- Pruebas manuales sugeridas: venta $50 @16% → cobra $50; cancelar una venta a
  crédito → saldo y stock vuelven; recibir a crédito → aparece la CxP y se puede
  pagar; doble-clic en recepción → no duplica.
