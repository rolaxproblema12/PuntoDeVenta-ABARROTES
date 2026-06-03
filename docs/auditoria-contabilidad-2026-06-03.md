# Auditoría de Correctitud Contable/Monetaria — POS de Abarrotes
**Rama:** `feat/inventario-caja-mejoras` · **Fecha:** 2026-06-03 · **Alcance:** ventas, devoluciones, compras, inventario/costos, caja, crédito, reportes, primitivas de dinero

---

## 1. Resumen ejecutivo

**¿Suma y cobra bien hoy?** En el flujo de venta de mostrador *actual* (efectivo exacto, sin descuentos, sin propina, sin crédito), **sí**: el cobro al cliente, el desglose de IVA contenido (corregido en la migración 0024) y la conciliación de efectivo del corte cuadran. El dinero que entra y sale en el camino feliz es correcto.

**El problema no está en lo que cobra, sino en lo que NO revierte y en lo que NO concilia.** Hay tres clases de defectos contables reales:

1. **Reversa inexistente (lo más grave y ya alcanzable hoy).** Cancelar una venta solo cambia un estado: **no devuelve stock, no abona el crédito del cliente y no repone lotes**. Y las devoluciones simplemente no existen como operación. Esto corrompe permanentemente inventario y cuentas por cobrar.

2. **Contrato de cobro demasiado permisivo (latente, se dispara al crecer).** El motor de ventas acepta descuentos mayores al precio (totales negativos), cuenta el crédito como efectivo al calcular el vuelto, no acota el cargo a crédito al adeudo real, y permite registrar "tendered" mayor al total inflando el efectivo esperado. Hoy la pantalla del POS los evita, pero el contrato (validación + RPC) los acepta desde la cola offline, la API directa o cualquier pantalla futura.

3. **Reportes y compras que no netean ni concilian.** El "Libro de ventas" exportable **suma tickets cancelados** en su gran total (contradice los KPIs de la propia pantalla). Las compras suben inventario (activo) **sin generar la cuenta por pagar** (pasivo) ni reabastecer lotes FIFO.

**Conteo de hallazgos confirmados:** 18 distintos (tras fusionar duplicados de "cancelSale"). Por severidad de consenso: **2 Críticos, 5 Altos, 7 Medios, 4 Bajos**.

**Riesgo de concurrencia destacado:** dos defectos de atomicidad (doble venta por doble-submit/retry, y sobregiro de límite de crédito por carrera) pueden duplicar ingresos/stock/deuda o exceder el crédito, y **sí son alcanzables hoy** vía el reintento offline del propio POS.

> **Nota de método:** las severidades aquí reflejan el consenso de la verificación adversarial, no necesariamente la etiqueta original. Donde el daño es solo "latente" (el contrato lo permite pero ninguna pantalla viva lo dispara) lo digo explícitamente, porque cambia la urgencia.

---

## 2. Hallazgos por severidad

### 🔴 CRÍTICO

#### C-1. Cancelar una venta no revierte NADA: inventario y crédito quedan corruptos permanentemente
**Dominio:** ventas / inventario-costos / caja-crédito (mismo bug visto desde 5 ángulos — fusionado)
**Archivo:** `apps/api/src/modules/sales/sales.service.ts:23-38`
**Endpoint vivo:** `POST /sales/:id/cancel` (`sales.module.ts:37-46`, con rol supervisor + PIN — es un flujo de usuario real, no un stub).

**Qué está mal:** `cancelSale` hace un único `UPDATE sales SET status='cancelada'` por `supabase-js`, fuera de cualquier RPC (viola la regla dura "toda escritura multi-tabla en UNA función Postgres"). El propio comentario lo admite: *"la reversa de stock se moverá a una RPC dedicada en Fase 1"*. Pero la venta original ya:
- descontó `branch_stock` (movimiento `'venta'` con cantidad negativa) y consumió lotes FIFO (`fifo_consume_lots`);
- si fue a crédito, insertó `customer_credit_movements` kind `'cargo'` que el trigger sumó a `customers.current_balance`.

Al cancelar **no se inserta el abono compensatorio ni el reingreso de stock**. No existe trigger sobre `UPDATE` de `sales` que lo haga. El efectivo SÍ se auto-corrige (los cortes filtran `status='completada'`), pero **el saldo de crédito y el inventario quedan inflados/subvaluados para siempre.** Peor: `assert_credit_available` lee ese `current_balance` inflado, así que la deuda fantasma bloquea ventas a crédito futuras legítimas del cliente.

**Ejemplo numérico:**
- *Crédito:* cliente límite $1,000, saldo $0. Venta a crédito $300 → `current_balance = 30000c`, disponible $700. Se cancela → `status='cancelada'` pero `current_balance` **sigue en 30000c**. El cliente no debe nada real, pero su crédito disponible quedó reducido $300 permanentemente.
- *Inventario:* stock=10, lote=10, avg_cost=2000c. Venta de 3 → branch_stock=7, lote=7. Se cancela → **siguen en 7**. Físico real=10; sistema muestra 7. Valor reportado 7×2000=14000c vs 20000c reales: 3 unidades ($60) "evaporadas", y el lote FIFO queda consumido por una venta que ya no existe.

**Corrección:** crear una RPC atómica `cancel_sale(p_sale_id, p_reason)` (SECURITY DEFINER, idempotente) que dentro de una sola transacción: (1) marque `cancelada`; (2) inserte por cada `sale_item` un `inventory_movements` de reingreso (+cantidad) y reponga los lotes FIFO; (3) si hubo pago a crédito, inserte `customer_credit_movements` kind `'abono'` por el cargo original. **Mientras no exista, bloquear la cancelación de ventas a crédito o ya descargadas de inventario.**

---

#### C-2. No existe operación de devoluciones: `createReturnSchema` no llega a ningún handler
**Dominio:** devoluciones
**Archivos:** `packages/shared/src/schemas/sale.ts:62` (schema huérfano) · `apps/api/src/modules/sync/sync.module.ts:19-29` · `supabase/migrations/0010_rpcs.sql:193-201`

**Qué está mal:** `createReturnSchema` solo está cableado como `op_type 'return.create'` dentro de `replaySyncOpSchema`. Su único consumidor es `POST /sync/replay`, que delega en la RPC `replay_sync_op`. Pero esa RPC **solo maneja `'sale.create'`**; cualquier otro tipo ejecuta `raise exception 'UNSUPPORTED_OP'`. No existe ninguna RPC `register_return`, ni endpoint `POST /sales/:id/return`. Las tablas `returns`/`return_items` existen y `cash_session_summary` **ya resta** las devoluciones en efectivo del efectivo esperado — es decir, el modelo asume que las devoluciones poblarán esas tablas, pero no hay forma de poblarlas.

**Ejemplo numérico:** cliente devuelve 1 producto de una venta de $50 @16% (IVA contenido $6.90, base $43.10). El payload `return.create` válido se envía y la DB responde `UNSUPPORTED_OP`. **Cero escrituras:** no reingresa stock, no abona crédito, no sale efectivo, no se revierte IVA. La venta queda 100% vigente aunque la mercancía volvió físicamente. Inventario, cartera y caja quedan sobrevaluados.

**Matiz honesto (por esto un lente votó "no-bug" y otros bajaron a Alto):** hoy **ninguna UI dispara `return.create`** (no hay pantalla de devolución), y cuando se invoca, el sistema falla *duro y explícito* — no calcula un número equivocado en silencio. Es una **funcionalidad faltante declarada de Fase 1+**, no una corrupción activa. Lo marco crítico por **completitud contable** (un POS sin devoluciones no es contablemente operable y todo el andamiaje de caja ya cuenta con ellas), pero su urgencia depende de cuándo se opere con devoluciones reales.

**Corrección:** implementar RPC atómica `register_return(p_payload)` (ver detalle en plan, sección 5). Debe calcular el reembolso **proporcional con IVA contenido** sobre `sale_items.line_total`: `refund_line = round(line_total × qty_dev / qty_vendida)`, `tax_dev = round(refund_line × r/(1+r))`. Validar `qty_dev ≤ (vendida − ya_devuelta)`. Cablear `replay_sync_op` para despachar `'return.create'`.

---

### 🟠 ALTO

#### A-1. `register_sale` no es seguro ante concurrencia: doble ejecución duplica venta, stock y cargo de crédito
**Dominio:** ventas · **Alcanzable HOY** ✅
**Archivo:** `supabase/migrations/0024_fix_register_sale_iva.sql:42-47, 149-153`

**Qué está mal:** la idempotencia se apoya en un `SELECT` inicial sobre `sync_queue` (status `'applied'`) **sin tomar lock**, y un `INSERT ... ON CONFLICT (client_op_id) DO UPDATE` al final. Bajo READ COMMITTED, dos transacciones con el mismo `client_op_id` (doble-clic, retry tras timeout, o `drainQueue` cada 30s solapándose con un POST en vuelo) **ambas pasan el SELECT** (aún no hay fila `'applied'`) y ejecutan todo el cuerpo: dos ventas, dos juegos de items, dos movimientos de inventario y **dos cargos de crédito**. El `ON CONFLICT DO UPDATE` NO lanza error ni revierte — la segunda transacción *commitea* sus efectos duplicados igual. El comentario del repo ("un replay duplicado nunca duplica la venta") solo es cierto para reintentos **secuenciales**, no **concurrentes**.

> El POS re-encola el mismo `client_op_id` ante 5xx (`PosPage.tsx:175-180`) y `drainQueue` corre por timer — el solapamiento es real, no hipotético.

**Ejemplo numérico:** venta a crédito de $50 doble-enviada → 2 ventas (folios SUC-0001 y SUC-0002), stock −2 unidades, `current_balance` del cliente +$100 en vez de +$50. Ingresos, depleción de stock y deuda duplicados.

**Corrección:** al entrar, tomar lock determinístico: `perform pg_advisory_xact_lock(hashtextextended(v_op::text, 0))` y **re-consultar** `sync_queue` tras el lock. O bien insertar primero la fila `sync_queue` en `'pending'` con `ON CONFLICT DO NOTHING` y abortar si ya existía, para que la unicidad serialice ANTES de escribir ventas/inventario/crédito.

---

#### A-2. El "Libro de ventas" exportable suma tickets cancelados/devueltos en su gran total
**Dominio:** reportes / primitivas-dinero (dos hallazgos idénticos — fusionado) · **Alcanzable HOY** ✅
**Archivo:** `apps/web/src/features/reports/ReportsPage.tsx:69-85, 175-201` · `apps/web/src/lib/export/matrix.ts:27-43`

**Qué está mal:** la query `ledger` trae TODAS las ventas del periodo **sin filtrar `status`**. `ledgerDataset` se exporta con `totals: true`, y `totalsRow` suma ciegamente las columnas money (Subtotal, IVA, Descuento, Total) de **todas** las filas, incluidas `'cancelada'`. `cancelSale` no pone a cero los montos, así que las canceladas conservan su importe. Esto **contradice los KPIs en pantalla** (que sí filtran `'completada'`), de modo que el reporte oficial exportado y la pantalla no cuadran. Riesgo fiscal: el IVA exportado queda sobreestimado.

**Ejemplo numérico:** A completada $116 + B completada $58 + C cancelada $200. KPI "Ventas del periodo" = $174 (correcto). Fila TOTAL del Excel/CSV/PDF = **$374** (incluye los $200 cancelados). Subtotal, IVA y Descuento igualmente inflados.

**Corrección:** filtrar la query `ledger` a `status='completada'` para los totales (o filtrar las filas antes de pasarlas a `ledgerDataset`, o dar a `totalsRow` un predicado de exclusión). Mantener las canceladas visibles en pantalla pero **nunca** sumarlas.

---

#### A-3. La recepción de mercancía no genera cuenta por pagar ni vincula la orden de compra
**Dominio:** compras · **Alcanzable HOY** ✅ (la UI confirma "Mercancía recibida")
**Archivo:** `apps/web/src/features/purchasing/PurchasingPage.tsx:184-206`

**Qué está mal:** "Recibir mercancía" solo inserta `inventory_movements`. **Nunca escribe** en `accounts_payable`, `purchase_orders`, `po_items` ni `goods_receipts`. Por tanto: las compras a crédito jamás generan deuda con el proveedor, la pestaña "Cuentas por pagar" queda permanentemente vacía, y no hay saldo a proveedores. **Contablemente: aumenta el inventario (activo) sin reconocer el pasivo correspondiente** — asiento de un solo lado.

**Ejemplo numérico:** recibo $5,000 a crédito de 30 días. `branch_stock` sube (activo +$5,000) pero `accounts_payable` no recibe fila → KPI "Cuentas por pagar" = $0 aunque realmente se deba $5,000.

**Corrección:** RPC atómica `receive_goods(p_payload)` que, además del movimiento de inventario y el lote, inserte `goods_receipts` + `goods_receipt_items`, actualice `po_items.qty_received` y `purchase_orders.status/total`, y cree/actualice `accounts_payable` (con `due_date` según `suppliers.terms_days`) cuando la compra sea a crédito. Usar `receiveGoodsSchema` como contrato.

---

#### A-4. Las devoluciones nunca se restan de ingresos, IVA ni top de productos en reportes
**Dominio:** reportes · **Latente** (depende de C-2)
**Archivo:** `supabase/migrations/0011_report_views.sql:18-34`

**Qué está mal:** `v_sales_daily` y `v_top_products` filtran solo `status='completada'` y **no restan** `returns`/`return_items`. Como (ver C-2) no existe RPC que cambie `sales.status` a `'devuelta'` ni que reste cantidades, una devolución parcial dejaría la venta `'completada'` con sus montos íntegros, y las vistas la contarían al 100% del bruto. `cash_session_summary` SÍ resta devoluciones en efectivo, lo que confirma la asimetría: el lado de caja se reconcilia, el de ingresos/IVA/unidades no.

**Ejemplo numérico:** venta de 10 pzas, line_total $100, IVA $13.79. Cliente devuelve 4 pzas. La venta sigue `'completada'`. `v_top_products` reporta qty=10 y revenue=$100 (debería 6 y $60); KPIs reportan ingreso $100 e IVA $13.79 cuando el neto real es $60 e IVA $8.28.

**Matiz honesto:** dos de tres lentes lo bajaron a **Medio** porque hoy el impacto es nulo (no hay forma de crear devoluciones — está acoplado a C-2). Lo dejo como Alto/Medio en frontera: es estructural y se activará el día que se implementen devoluciones **si no se actualizan las vistas a la vez**.

**Corrección:** al construir `register_return`, netear en reportes: `revenue_neto = sum(line_total) − sum(refund_amount)`, `qty_neta = sum(si.quantity) − sum(ri.quantity)`; `v_sales_daily` debe restar `returns.total` y el IVA devuelto del día.

---

#### A-5. Abono de crédito sin tope deja `current_balance` negativo (sobrepago no modelado)
**Dominio:** crédito · **Alcanzable HOY** ✅ (votos partidos: high/high/medium → lo dejo en Alto)
**Archivos:** trigger `apply_credit_movement` (versión vigente en `0021_security_hardening.sql:25-42`, reemplaza a `0006:44-58`) · origen `apps/web/src/features/customers/CustomersPage.tsx:73-94`

**Qué está mal:** el trigger resta el abono **sin piso en cero** (`v_bal := v_bal + (cargo? +amount : -amount)`, sin `greatest(0,…)`), no hay CHECK `current_balance >= 0`, y `doAbono` solo valida `cents > 0` — nunca compara contra el saldo. Un abono mayor al adeudo deja saldo negativo: un "saldo a favor" fantasma que el modelo no contempla como anticipo. Agravante: `assert_credit_available` usa `v_bal + p_amount > v_lim`, así que un saldo negativo **infla el crédito disponible** silenciosamente (límite + sobrepago).

**Ejemplo numérico:** cliente debe $50 (5000c). Cajero captura abono de $80 (8000c) → `current_balance = 5000 − 8000 = −3000` = −$30. La UI lo muestra en color neutro (no alarma) y el cliente ahora puede cargar a crédito hasta `límite + $30`.

**Corrección:** en el trigger, para `kind='abono'` validar `amount <= current_balance` (raise `ABONO_EXCEDE_SALDO`) o clamp a 0; y/o modelar explícitamente anticipos con su propia semántica. Validar también en `doAbono` que `cents <= current_balance`.

---

### 🟡 MEDIO

#### M-1. Descuento mayor al precio genera línea y total negativos (sin validación en ninguna capa)
**Dominio:** ventas · **Latente** (el POS fija `discount:0` hoy)
**Archivo:** `packages/shared/src/schemas/sale.ts:13-17, 39-56` · `packages/shared/src/money.ts:43-49` · RPC `0024:69-80,113`

**Qué está mal:** `unit_price` y `discount` se validan como enteros no-negativos **por separado**; nadie exige `discount <= unit_price`. `lineTotalCents` y `register_sale` calculan `(unit_price − discount) × qty` **sin piso en cero**. El refine solo verifica `paid >= total`; con total negativo, un pago de 0 lo "cubre". Las columnas DB no tienen CHECK `>= 0`. Se persiste una venta `'completada'` con subtotal/IVA/total negativos que resta de los reportes y del efectivo esperado.

**Ejemplo numérico:** unit_price=5000c, discount=7000c, qty=1 → v_line = −2000c; IVA = round(−2000×0.16/1.16) = −276c; total = −2000c. Un pago de $0 pasa el refine. Se registra una "venta" de −$20.

**Corrección:** en `saleItemInputSchema` añadir `superRefine` por línea: `discount <= unit_price`. En `register_sale` aplicar `greatest(unit_price − discount, 0)` o lanzar excepción si la línea es negativa. Endurecer el refine para exigir `total > 0`.

---

#### M-2. Chequeo de límite de crédito sin lock de fila: carrera permite exceder el límite
**Dominio:** crédito · **Alcanzable HOY** ✅ (votos: medium/high/medium → Medio)
**Archivos:** `assert_credit_available` (`0010_rpcs.sql:35-50`) · `register_sale` (`0024:123-132`)

**Qué está mal:** `assert_credit_available` es `STABLE` y lee `current_balance` **sin `FOR UPDATE`**. El lock de fila recién ocurre en el trigger, DESPUÉS de que la validación ya pasó, y el trigger **no revalida el límite**. Es un TOCTOU clásico: dos ventas a crédito concurrentes del mismo cliente leen el mismo saldo, ambas pasan, ambas cargan.

**Ejemplo numérico:** límite $1000, saldo $800. Caja A y Caja B registran $200 cada una simultáneamente. Ambas leen $800 → $800+$200=$1000 ≤ $1000 OK. Saldo final = $1200 > $1000. Límite violado.

**Corrección:** consolidar lectura+validación+mutación bajo el mismo lock. En `register_sale` hacer `SELECT ... FROM customers WHERE id=v_cust FOR UPDATE` antes de `assert_credit_available`, o revalidar el límite dentro del trigger ya con la fila bloqueada. Quitar `STABLE`.

---

#### M-3. El cargo a crédito no se acota al adeudo real; sobrepago genera "cambio" en efectivo e infla la deuda
**Dominio:** crédito · **Latente** (no hay UI de pago mixto/crédito hoy)
**Archivo:** `supabase/migrations/0024_fix_register_sale_iva.sql:115-147`

**Qué está mal:** el cargo a crédito se inserta con el `amount` del payment tal cual, sin validar que `amount <= total − otros_pagos`. El zod solo exige `paid >= total` sin distinguir método. Como `change = greatest(v_paid − v_total, 0)`, un pago a crédito mayor de lo debido combinado con efectivo **genera vuelto en efectivo mientras sobrecarga la cuenta por cobrar**.

**Ejemplo numérico:** total $50. Pagos: efectivo $30 + crédito $40 → paid=$70 ≥ $50 (pasa). Se carga $40 a crédito (debió ser ≤ $50−$30 = $20) y change = $70−$50 = $20 en efectivo. El cliente recibe $20 y queda debiendo $20 de más.

**Corrección:** en `register_sale`, calcular el cargo a crédito como el **residuo no cubierto por otros métodos** (`total − sum(no_credito)`), no confiar en el `amount` enviado; rechazar si la suma de pagos excede el total cuando hay crédito (un cargo a crédito nunca debe producir vuelto).

---

#### M-4. Pagos con `method='mixto'` desaparecen del desglose por método del corte
**Dominio:** caja · **Latente** (votos: medium/low/medium → Medio)
**Archivos:** `0005_cash_sales.sql:116-125` (CHECK permite `'mixto'`) · `0020_cash_movements.sql:48-60` (sin rama `'mixto'`)

**Qué está mal:** el CHECK de `sale_payments.method` y el enum zod permiten `'mixto'` como método de **línea** de pago, pero `cash_session_summary` solo agrega filtros para efectivo/tarjeta/transferencia/credito. Un pago `'mixto'` no cae en ninguno → se omite de `by_method` y, si era efectivo, de `expected_cash`. Pero SÍ cuenta en `sales_total`. Resultado: `sum(by_method) < sales_total`, descuadre silencioso. `'mixto'` debería existir solo como descriptor de cabecera (`sales.payment_method`), no como método de línea.

**Ejemplo numérico:** venta $200 con un único `sale_payment {method:'mixto', amount:20000}`. `by_method` = {todos en 0}; `sales_total` = $200. El corte muestra Venta $200 pero $0 en todos los métodos.

**Corrección:** quitar `'mixto'` del CHECK de `sale_payments` y del enum usado por `salePaymentInputSchema` (dejarlo solo en cabecera), o que `register_sale` rechace `v_method='mixto'` por línea.

---

#### M-5. Recepción y abonos escriben directo a tablas (no vía RPC atómica): recepción parcial sin rollback
**Dominio:** primitivas-dinero / compras · **Alcanzable HOY** ✅
**Archivo:** `apps/web/src/features/purchasing/PurchasingPage.tsx:184-206`

**Qué está mal:** el handler `receive` inserta `inventory_movements` en un **bucle de inserts sucesivos** de supabase-js, cada uno su propia transacción autocommit (viola la regla de RPC atómica). Si la 2ª línea falla tras la 1ª, queda una recepción **parcial sin rollback**: el stock/costo de la 1ª ya subió, y como el formulario no se limpia ante error, un re-intento **duplica** el costo de la línea ya aplicada.

**Ejemplo numérico:** L1 (10u @ $20) + L2 (5u @ $50), total $300. Se inserta L1 (stock +10, $200 aplicado) y L2 falla. Al reintentar ambas, L1 se cuenta dos veces → $200 de inventario fantasma.

> **Corrección de un error del hallazgo:** la sub-afirmación sobre `doAbono` es **falsa**. `apply_credit_movement` NO es una RPC sino un *trigger* `BEFORE INSERT`; el abono es un único insert atómico con `FOR UPDATE`, así que ese caso **no tiene problema de atomicidad** (su problema es otro: el sobrepago de A-5).

**Corrección:** mover la recepción a una RPC `receive_goods(p_payload)` que inserte todas las líneas + stock/costo + lote + CxP en una sola transacción (resuelve también A-3).

---

#### M-6. El costo de lo vendido (COGS) usa el costo de lista del cliente, no el del lote consumido — y es manipulable
**Dominio:** inventario-costos (dos hallazgos relacionados — fusionado) · **Latente** (ningún reporte de margen lo consume hoy)
**Archivos:** `register_sale` (`0024:93,105`) · `packages/shared/src/schemas/sale.ts:14` · POS `PosPage.tsx:97,105,136`

**Qué está mal:** `register_sale` persiste en `sale_items.unit_cost` el valor que envía el cliente (que el POS toma de `product_prices.cost`, costo de lista vigente, con fallback `?? 0`). El consumo real es FIFO sobre `lots.cost`, pero `fifo_consume_lots` devuelve `void` y **nunca reporta el costo del lote**. Además, el schema solo valida `unit_cost int >= 0 default 0` — no lo cruza contra ninguna fuente del servidor, así que un POS sin precio cargado envía 0 y un cliente manipulado envía cualquier cosa. El COGS guardado no corresponde ni al lote FIFO ni al promedio.

**Ejemplo numérico:** lote viejo a 1000c/u; sube `product_prices.cost` a 1500c. Se venden 3 → COGS guardado 3×1500=4500c; COGS FIFO real 3×1000=3000c. Margen subestimado $15. O bien: POS sin costo cargado → COGS=0 → margen reportado 100%.

**Matiz honesto:** un lente lo bajó a **Bajo** porque hoy **ningún reporte lee `sale_items.unit_cost`** para margen/utilidad (`ReportsPage` no usa costo), y la valuación del inventario usa `branch_stock.avg_cost` (promedio móvil), no FIFO. Es deuda latente: corromperá el primer reporte de utilidad que se construya. El cobro al cliente NO se ve afectado.

**Corrección:** derivar el costo en el servidor: hacer que `fifo_consume_lots` devuelva el costo ponderado de los lotes consumidos y usarlo como `unit_cost`, o usar `branch_stock.avg_cost` al momento de la venta. **Ignorar el `unit_cost` del payload** (es manipulable).

---

#### M-7. Entrada de mercancía sin costo hereda el promedio (o 0); el lote nuevo recibe un costo inventado
**Dominio:** inventario-costos · **Alcanzable HOY** ✅ (el campo de costo en la UI es opcional)
**Archivo:** `supabase/migrations/0019_inventory_movements.sql:56-64`

**Qué está mal:** en `record_stock_movement` kind `'entrada'`, si no se envía `unit_cost` se usa el promedio actual (`v_avg`) tanto para el movimiento como para el costo del **nuevo lote** (`lots.cost = v_avg`). Para un producto nuevo (avg=0), el lote entra con **cost=0**, regalando contablemente la mercancía. No hay CHECK que prohíba `cost=0` en entrada.

**Ejemplo numérico:** producto nuevo, avg=0, entrada de 20 unidades sin capturar costo. Lote con cost=0, avg sigue 0. Valor de inventario = 20×0 = $0 aunque la compra costó, p.ej., $300. Cualquier venta posterior consume ese lote con COGS=0 → margen 100% ficticio.

**Corrección:** para `'entrada'`, exigir `unit_cost > 0` (al menos cuando el avg actual es 0). El lote debe llevar su costo de compra real; el promedio solo es válido para el cálculo del promedio ponderado, no para etiquetar un lote físico.

---

### 🟢 BAJO

#### B-1. El vuelto (`change`) cuenta el crédito como efectivo recibido
**Dominio:** ventas · **Latente / valor muerto** (votos: low/medium/no-bug)
**Archivo:** `supabase/migrations/0024_fix_register_sale_iva.sql:115-118, 147`

`v_paid` acumula todos los pagos (incluido `'credito'`) y `change = greatest(v_paid − v_total, 0)`. Una venta mixta con crédito reporta un vuelto en efectivo que no debe entregarse. **Pero `change` es valor de salida muerto:** no se persiste, no lo usa la API ni el POS, y `expected_cash` se calcula solo con `sale_payments` de método efectivo (no resta `change`). Por eso **no descuadra la caja** — su único riesgo es un vuelto mal mostrado en una pantalla futura de pago mixto. Corregir junto con M-3 (el cálculo de `change` debe excluir métodos no-efectivo).

#### B-2. El "tendered" en efectivo se registra sin descontar el cambio (efectivo esperado inflado — latente)
**Dominio:** caja · **Latente / no alcanzable hoy** (votos: medium/medium/no-bug → Bajo)
**Archivos:** `0024:115-147` · `0020:48-77` · `sale.ts:39-56`

El contrato permite `paid > total` y persiste el `amount` íntegro en `sale_payments`; si una UI futura registrara el efectivo *entregado* ("paga con $100" por una venta de $50) sin restar el cambio, `expected_cash` quedaría inflado y el corte marcaría faltante sistemático = suma de cambios. **Hoy el POS envía `amount = total` exacto**, así que `change=0` y el corte cuadra. Es un hueco de contrato a cerrar antes de implementar captura de "paga con". Corrección: el efectivo que entra al cajón es `min(pago_efectivo, total_no_cubierto)`, nunca el tendered.

#### B-3. Subtotal/total de recepción redondea `qty × precio` en pesos en vez de `qty × round(precio)`
**Dominio:** compras / primitivas-dinero · **Cosmético** (votos unánimes: Bajo)
**Archivo:** `apps/web/src/features/purchasing/PurchasingPage.tsx:246-249, 421-424`

El total mostrado redondea una vez `qty×precio_pesos`, mientras que lo persistido es `round(precio)×qty` por unidad. Divergen ≤1¢/línea con costos de >2 decimales. **El total mostrado no se persiste** (solo es display; ni siquiera genera CxP), así que el libro mayor no se corrompe. *(El ejemplo numérico original del hallazgo está mal por punto flotante: `toCents(1.005)=100`, no 101; la divergencia real es de 1¢, no 1¢ en el sentido descrito.)* Corrección: usar `toCents(unit_cost) × qty`, consistente con lo almacenado.

#### B-4. Total por línea del carrito POS ignora el descuento (display latente)
**Dominio:** primitivas-dinero · **Latente / no alcanzable hoy** (votos: low/low/no-bug → Bajo)
**Archivo:** `apps/web/src/features/pos/PosPage.tsx:325-327`

El importe mostrado por línea usa `unitPrice × quantity` sin restar `discount`, mientras el total cobrado y el RPC sí lo restan. **Pero el POS fija `discount:0` y no hay UI para editarlo**, así que hoy display == cobrado == RPC siempre. Es una primitiva de display incorrecta que solo divergirá al habilitar descuentos por línea. El dinero realmente cobrado es correcto. Corrección: usar `lineTotalCents(l.unitPrice, l.quantity, l.discount)` también en el display.

#### (También Bajo, mencionados brevemente)
- **`close_cash_session` no valida que `counted_cash` == suma de denominaciones** (`0020:127-178`): permite un registro de auditoría contradictorio si un cliente no-web envía un payload inconsistente. La aritmética del corte es correcta; es defensa en profundidad. Corrección: si vienen `denominations`, exigir que su suma iguale `counted_cash`.
- **Valor de inventario en UI** (`InventoryPage.tsx:246-249`): suma `round(stock×avg_cost)` por fila; con cantidades fraccionarias, sumar redondeos por fila difiere de redondear el total (puede desviar algunos centavos). Es 100% presentación, no toca DB, y no hay valuación de servidor con la cual deba cuadrar. Corrección: redondear una sola vez el gran total.

---

## 3. Hallazgos descartados (para despejar dudas comunes)

Verificados como **NO bugs contables** — no los traten como pendientes:

- **`fifo_consume_lots` consume silenciosamente sin validar suficiencia** y diverge de `branch_stock` con lotes vencidos: real como higiene de datos, pero **no corrompe ningún monto** — la valuación usa `branch_stock.avg_cost` (no `sum(qty_remaining×cost)`), y `lots.cost`/`qty_remaining` solo alimentan la alerta de caducidad. Es deuda de inventario/FIFO, fuera del alcance contable.
- **La recepción no crea lote FIFO** (insert directo en vez de `record_stock_movement`): mismo razonamiento — `branch_stock` y `avg_cost` quedan correctos; solo se degrada la alerta de caducidad y el costeo por capa FIFO (que ningún cálculo monetario consume hoy). *(Se resuelve igualmente con la RPC `receive_goods` de A-3/M-5.)*
- **Costo unitario negativo en recepción**: posible en teoría, pero requiere que un operador teclee un costo negativo manualmente; impacto acotado a `avg_cost`. Real pero menor. *(También cubierto por `receive_goods` con guard `BAD_COST`.)*

---

## 4. Completitud y riesgos

Como crítico de completitud, estas son las **áreas contables no cubiertas del todo** o que requieren verificación manual:

1. **Devoluciones (el hueco más grande).** No existen como operación (C-2) y los reportes no las netean (A-4). Todo el subsistema —RPC, reembolso proporcional con IVA contenido, reingreso de stock/lotes, abono de crédito, egreso de caja, neteo en reportes— está por construir. **Sin esto, el POS no es contablemente operable** en un negocio con devoluciones.

2. **Compras / cuentas por pagar.** El ciclo de compra está a medias: entra inventario pero no se reconoce el pasivo (A-3), no se actualiza `product_prices.cost` con el costo de compra (descartado pero relevante para márgenes), y no hay documento de compra que respalde el costo. **El balance activo/pasivo no cuadra para compras a crédito.**

3. **Cancelaciones y reversa.** Hoy una cancelación es una mutación parcial (C-1). Requiere RPC atómica de reversa con idempotencia.

4. **Concurrencia.** Dos defectos de atomicidad (A-1 doble venta, M-2 sobregiro de crédito) son alcanzables hoy. Recomiendo **prueba manual de carga**: doble-submit del POS con red lenta, y dos cajas vendiendo a crédito al mismo cliente al límite.

5. **Zona horaria de reportes** (descartado por 0 votos, pero verifíquenlo): `v_sales_daily` agrupa por día en UTC. Si el negocio opera en huso distinto, los cortes diarios podrían asignar ventas de la madrugada al día equivocado. **Verificación manual recomendada:** comparar el total de un día del libro contra el corte Z local.

**Verificación manual sugerida:**
- Hacer una venta a crédito, cancelarla, y confirmar en `customers.current_balance` y `branch_stock` que NO se revirtió (reproduce C-1).
- Exportar el Libro de ventas en un periodo con al menos una venta cancelada y comparar la fila TOTAL contra el KPI de pantalla (reproduce A-2).
- Recibir mercancía a crédito y revisar que "Cuentas por pagar" sigue en $0 (reproduce A-3).
- Capturar un abono mayor al saldo de un cliente y ver el saldo negativo (reproduce A-5).

---

## 5. Plan de corrección sugerido (por prioridad)

**Prioridad 0 — Atomicidad y reversa (alcanzable hoy, corrompe datos reales):**
1. **RPC `cancel_sale` atómica** con reversa de stock, lotes y abono de crédito + idempotencia (C-1). Mientras tanto, **bloquear cancelación de ventas a crédito**.
2. **Lock de idempotencia en `register_sale`** (`pg_advisory_xact_lock` + re-consulta, o pre-insert `pending`) para cerrar la doble venta concurrente (A-1).
3. **Lock de fila en el chequeo de crédito** (`SELECT ... FOR UPDATE` antes de `assert_credit_available`) (M-2).

**Prioridad 1 — Reportes y compras (alcanzable hoy, engaña al dueño):**
4. **Filtrar `status='completada'` en el Libro de ventas exportable** (A-2) — corrección de una línea, alto impacto.
5. **RPC `receive_goods`** atómica: lote FIFO + movimiento + stock/costo + `goods_receipts` + `accounts_payable` (A-3, M-5, y resuelve de paso los descartados de lote/costo negativo). Exigir `unit_cost > 0` en entrada (M-7).
6. **Tope al abono de crédito** (no dejar saldo negativo) (A-5).

**Prioridad 2 — Endurecer el contrato antes de crecer (latentes, pero el contrato ya los acepta):**
7. **Validaciones de `register_sale`/zod:** `discount <= unit_price` y `total > 0` (M-1); acotar cargo a crédito al residuo y calcular `change` solo sobre efectivo (M-3, B-1, B-2); rechazar `method='mixto'` por línea (M-4).
8. **Derivar COGS en el servidor** (FIFO o avg_cost), ignorar el `unit_cost` del payload (M-6).

**Prioridad 3 — Subsistema de devoluciones (completitud):**
9. **RPC `register_return`** con reembolso proporcional e IVA contenido, reversa de stock/lotes, abono/egreso, idempotencia; cablear `replay_sync_op` y endpoint; **netear devoluciones en `v_sales_daily`/`v_top_products`** (C-2, A-4).

**Prioridad 4 — Cosméticos:**
10. Display de línea con descuento (B-4), subtotal de recepción consistente (B-3), validar denominaciones en el corte, redondeo único del valor de inventario en UI.

---

**Veredicto final:** el motor de IVA contenido y el cobro de mostrador básico están **correctos** (la migración 0024 arregló el doble IVA y la conciliación de efectivo del corte es sólida). Los riesgos reales no son de "suma mal el ticket", sino de **no revertir** (cancelaciones, devoluciones), **no conciliar** (cuentas por pagar, reportes que mezclan bruto/cancelado) y **un contrato de venta demasiado abierto** que se volverá peligroso al habilitar descuentos, pagos mixtos, crédito y la cola offline a escala. Priorizar P0 y P1 antes de operar con crédito o múltiples cajas.