-- 0027_accounting_fixes: corrige defectos detectados en la revisión adversarial
-- de 0025/0026 (interacción cancelación↔devolución, idempotencia de recepción,
-- doble resta de efectivo en el corte, valuación de reversa, pago a proveedores).
-- No edita migraciones aplicadas: redefine funciones/vistas y amplía un CHECK.

-- ── Amplía sync_queue.op_type para idempotencia de recepción de compras ──────
alter table sync_queue drop constraint if exists sync_queue_op_type_check;
alter table sync_queue add constraint sync_queue_op_type_check
  check (op_type in ('sale.create','sale.cancel','return.create','purchase.receive'));

-- ── cancel_sale: bloquea casos que descuadraban la contabilidad ──────────────
-- Fixes:
--  * [#1/#4/#5] Rechaza cancelar una venta que YA tiene devoluciones (parciales o
--    totales): antes reingresaba la cantidad ORIGINAL (doble conteo de stock) y
--    revertía el cargo completo sin descontar el abono de la devolución.
--  * [#9] Rechaza cancelar si la sesión de caja ya está cerrada (el corte Z congeló
--    expected_cash; usar devolución para reversas post-cierre).
--  * [#8] Reingresa el inventario al costo HISTÓRICO de la línea (sale_items.unit_cost),
--    no al avg_cost actual → la reversa devuelve exactamente el valor que salió.
create or replace function cancel_sale(p_sale_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suc uuid; v_status text; v_cust uuid; v_cs uuid; v_cs_status text;
  v_item record; v_lot uuid; v_credit bigint;
begin
  select sucursal_id, status, customer_id, cash_session_id
    into v_suc, v_status, v_cust, v_cs
  from sales where id = p_sale_id for update;
  if v_suc is null then
    raise exception 'SALE_NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  -- Idempotente: re-cancelar devuelve el estado sin re-escribir.
  if v_status = 'cancelada' then
    return jsonb_build_object('sale_id', p_sale_id, 'status', 'cancelada',
                              'already_cancelled', true);
  end if;
  if v_status = 'devuelta' then
    raise exception 'SALE_ALREADY_RETURNED: la venta ya fue devuelta'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from returns where sale_id = p_sale_id) then
    raise exception 'SALE_HAS_RETURNS: la venta tiene devoluciones; no se puede cancelar'
      using errcode = 'check_violation';
  end if;
  select status into v_cs_status from cash_sessions where id = v_cs;
  if v_cs_status = 'closed' then
    raise exception 'SESSION_CLOSED: la sesión de caja ya fue cerrada; usa una devolución'
      using errcode = 'check_violation';
  end if;

  -- Reingreso de inventario por cada ítem físico, al costo histórico de la línea.
  for v_item in
    select product_id, quantity, unit_cost from sale_items
    where sale_id = p_sale_id and kind = 'producto' and product_id is not null
  loop
    insert into lots (product_id, sucursal_id, lot_code, qty_received,
                      qty_remaining, cost)
    values (v_item.product_id, v_suc, 'CANCEL-' || left(p_sale_id::text, 8),
            v_item.quantity, v_item.quantity, v_item.unit_cost)
    returning id into v_lot;
    insert into inventory_movements (sucursal_id, product_id, lot_id, kind,
                                     quantity, unit_cost, ref_type, ref_id,
                                     created_by)
    values (v_suc, v_item.product_id, v_lot, 'devolucion',
            v_item.quantity, v_item.unit_cost, 'sale_cancel', p_sale_id, auth.uid());
  end loop;

  -- Reversa del cargo a crédito (si lo hubo).
  select coalesce(sum(amount), 0) into v_credit
  from customer_credit_movements
  where sale_id = p_sale_id and kind = 'cargo';
  if v_credit > 0 and v_cust is not null then
    insert into customer_credit_movements (customer_id, sucursal_id, kind,
                                           amount, sale_id, created_by)
    values (v_cust, v_suc, 'abono', v_credit, p_sale_id, auth.uid());
  end if;

  update sales
  set status = 'cancelada', cancelled_at = now(), cancelled_by = auth.uid(),
      cancelled_reason = p_reason, updated_at = now()
  where id = p_sale_id;

  return jsonb_build_object('sale_id', p_sale_id, 'status', 'cancelada',
                            'stock_reversed', true, 'credit_reversed', v_credit);
end $$;

-- ── register_return: reingreso al costo histórico de la línea [#8] ────────────
create or replace function register_return(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_op       uuid := nullif(p_payload->>'client_op_id', '')::uuid;
  v_sale     uuid := (p_payload->>'sale_id')::uuid;
  v_reason   text := p_payload->>'reason';
  v_method   text := p_payload->>'refund_method';
  v_existing jsonb;
  v_suc uuid; v_status text; v_cust uuid;
  v_ret uuid;
  v_it jsonb;
  v_si record;
  v_already numeric;
  v_qty numeric;
  v_refund bigint;
  v_tax bigint;
  v_total_refund bigint := 0;
  v_tax_refund bigint := 0;
  v_lot uuid;
  v_fully boolean;
begin
  if v_op is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_op::text, 0));
    select result into v_existing from sync_queue
      where client_op_id = v_op and status = 'applied';
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select sucursal_id, status, customer_id
    into v_suc, v_status, v_cust
  from sales where id = v_sale for update;
  if v_suc is null then
    raise exception 'SALE_NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if v_status = 'cancelada' then
    raise exception 'SALE_CANCELLED: no se puede devolver una venta cancelada'
      using errcode = 'check_violation';
  end if;

  insert into returns (sucursal_id, sale_id, reason, refund_method, total, created_by)
  values (v_suc, v_sale, v_reason, v_method, 0, auth.uid())
  returning id into v_ret;

  for v_it in select * from jsonb_array_elements(p_payload->'items')
  loop
    select id, product_id, quantity, line_total, tax_rate, kind, unit_cost
      into v_si
    from sale_items
    where id = (v_it->>'sale_item_id')::uuid and sale_id = v_sale;
    if v_si.id is null then
      raise exception 'SALE_ITEM_NOT_IN_SALE' using errcode = 'check_violation';
    end if;

    v_qty := nullif(v_it->>'quantity', '')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'BAD_QTY' using errcode = 'check_violation';
    end if;

    select coalesce(sum(quantity), 0) into v_already
    from return_items where sale_item_id = v_si.id;
    if v_already + v_qty > v_si.quantity then
      raise exception 'RETURN_EXCEEDS_SOLD: devolución % excede lo vendido % (ya devuelto %)',
        v_qty, v_si.quantity, v_already using errcode = 'check_violation';
    end if;

    v_refund := round(v_si.line_total * v_qty / v_si.quantity);
    v_tax := round(v_refund * coalesce(v_si.tax_rate, 0)
                   / (1 + coalesce(v_si.tax_rate, 0)));
    v_total_refund := v_total_refund + v_refund;
    v_tax_refund := v_tax_refund + v_tax;

    insert into return_items (return_id, sale_item_id, quantity, refund_amount)
    values (v_ret, v_si.id, v_qty, v_refund);

    -- Reingreso de inventario al costo HISTÓRICO de la línea.
    if v_si.kind = 'producto' and v_si.product_id is not null then
      insert into lots (product_id, sucursal_id, lot_code, qty_received,
                        qty_remaining, cost)
      values (v_si.product_id, v_suc, 'RET-' || left(v_ret::text, 8),
              v_qty, v_qty, v_si.unit_cost)
      returning id into v_lot;
      insert into inventory_movements (sucursal_id, product_id, lot_id, kind,
                                       quantity, unit_cost, ref_type, ref_id,
                                       created_by)
      values (v_suc, v_si.product_id, v_lot, 'devolucion', v_qty, v_si.unit_cost,
              'return', v_ret, auth.uid());
    end if;
  end loop;

  if v_total_refund <= 0 then
    raise exception 'EMPTY_RETURN: la devolución no tiene monto'
      using errcode = 'check_violation';
  end if;

  update returns set total = v_total_refund where id = v_ret;

  if v_method = 'credito' then
    if v_cust is null then
      raise exception 'CREDIT_NO_CUSTOMER' using errcode = 'check_violation';
    end if;
    insert into customer_credit_movements (customer_id, sucursal_id, kind,
                                           amount, sale_id, created_by)
    values (v_cust, v_suc, 'abono', v_total_refund, v_sale, auth.uid());
  end if;

  select bool_and(coalesce(r.q, 0) >= si.quantity) into v_fully
  from sale_items si
  left join (select sale_item_id, sum(quantity) q from return_items
             group by sale_item_id) r on r.sale_item_id = si.id
  where si.sale_id = v_sale;
  if coalesce(v_fully, false) then
    update sales set status = 'devuelta', updated_at = now() where id = v_sale;
  end if;

  v_existing := jsonb_build_object(
    'return_id', v_ret, 'sale_id', v_sale, 'total', v_total_refund,
    'tax_refunded', v_tax_refund, 'fully_returned', coalesce(v_fully, false));

  if v_op is not null then
    insert into sync_queue (sucursal_id, client_op_id, op_type, payload,
                            status, result, applied_at)
    values (v_suc, v_op, 'return.create', p_payload, 'applied', v_existing, now())
    on conflict (client_op_id) do update
      set status = 'applied', result = excluded.result, applied_at = now();
  end if;

  return v_existing;
end $$;

-- ── receive_goods: ahora IDEMPOTENTE por client_op_id [#2] ────────────────────
-- Un reintento (timeout/respuesta perdida) ya no duplica stock ni la cuenta por
-- pagar: se serializa con advisory lock y se deduplica vía sync_queue.
create or replace function receive_goods(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_op     uuid    := nullif(p_payload->>'client_op_id', '')::uuid;
  v_suc    uuid    := (p_payload->>'sucursal_id')::uuid;
  v_sup    uuid    := nullif(p_payload->>'supplier_id', '')::uuid;
  v_credit boolean := coalesce((p_payload->>'on_credit')::boolean, false);
  v_existing jsonb;
  v_item   jsonb;
  v_prod   uuid;
  v_qty    numeric;
  v_cost   bigint;
  v_lot    uuid;
  v_total  bigint := 0;
  v_count  int := 0;
  v_terms  int;
  v_ap     uuid;
begin
  if v_op is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_op::text, 0));
    select result into v_existing from sync_queue
      where client_op_id = v_op and status = 'applied';
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if v_sup is not null
     and not exists (select 1 from suppliers where id = v_sup and sucursal_id = v_suc) then
    raise exception 'SUPPLIER_NOT_IN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;

  for v_item in select * from jsonb_array_elements(p_payload->'items')
  loop
    v_prod := (v_item->>'product_id')::uuid;
    v_qty  := nullif(v_item->>'qty_received', '')::numeric;
    v_cost := nullif(v_item->>'unit_cost', '')::bigint;
    if v_qty is null or v_qty <= 0 then
      raise exception 'BAD_QTY: cantidad recibida debe ser > 0'
        using errcode = 'check_violation';
    end if;
    if v_cost is null or v_cost <= 0 then
      raise exception 'BAD_COST: el costo unitario es obligatorio y > 0'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from products where id = v_prod and sucursal_id = v_suc) then
      raise exception 'PRODUCT_NOT_IN_SUCURSAL' using errcode = 'insufficient_privilege';
    end if;

    insert into lots (product_id, sucursal_id, lot_code, qty_received,
                      qty_remaining, cost, expiry_date)
    values (v_prod, v_suc,
            coalesce(nullif(v_item->>'lot_code', ''),
                     'C-' || to_char(now(), 'YYYYMMDDHH24MISS')),
            v_qty, v_qty, v_cost, nullif(v_item->>'expiry_date', '')::date)
    returning id into v_lot;

    insert into inventory_movements (sucursal_id, product_id, lot_id, kind,
                                     quantity, unit_cost, ref_type, created_by)
    values (v_suc, v_prod, v_lot, 'entrada', v_qty, v_cost, 'compra', auth.uid());

    v_total := v_total + round(v_cost * v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'NO_ITEMS: agrega al menos una línea' using errcode = 'check_violation';
  end if;

  if v_credit then
    if v_sup is null then
      raise exception 'SUPPLIER_REQUIRED: la compra a crédito requiere proveedor'
        using errcode = 'check_violation';
    end if;
    select coalesce(terms_days, 0) into v_terms from suppliers where id = v_sup;
    insert into accounts_payable (sucursal_id, supplier_id, amount, paid, due_date, status)
    values (v_suc, v_sup, v_total, 0, current_date + coalesce(v_terms, 0), 'pendiente')
    returning id into v_ap;
  end if;

  v_existing := jsonb_build_object('items', v_count, 'total', v_total,
                                   'on_credit', v_credit, 'payable_id', v_ap);

  if v_op is not null then
    insert into sync_queue (sucursal_id, client_op_id, op_type, payload,
                            status, result, applied_at)
    values (v_suc, v_op, 'purchase.receive', p_payload, 'applied', v_existing, now())
    on conflict (client_op_id) do update
      set status = 'applied', result = excluded.result, applied_at = now();
  end if;

  return v_existing;
end $$;

-- ── register_supplier_payment: paga (parcial/total) una cuenta por pagar [#11] ─
create or replace function register_supplier_payment(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ap     uuid   := (p_payload->>'payable_id')::uuid;
  v_suc    uuid   := (p_payload->>'sucursal_id')::uuid;
  v_amt    bigint := nullif(p_payload->>'amount', '')::bigint;
  v_ap_suc uuid; v_amount bigint; v_paid bigint; v_new_paid bigint; v_status text;
begin
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if v_amt is null or v_amt <= 0 then
    raise exception 'BAD_AMOUNT: el pago debe ser mayor a 0' using errcode = 'check_violation';
  end if;
  select sucursal_id, amount, paid into v_ap_suc, v_amount, v_paid
    from accounts_payable where id = v_ap for update;
  if v_ap_suc is null then
    raise exception 'PAYABLE_NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if v_ap_suc <> v_suc then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if v_amt > v_amount - v_paid then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: el pago % excede el saldo %',
      v_amt, (v_amount - v_paid) using errcode = 'check_violation';
  end if;
  v_new_paid := v_paid + v_amt;
  v_status := case
                when v_new_paid >= v_amount then 'pagada'
                when v_new_paid > 0 then 'parcial'
                else 'pendiente' end;
  update accounts_payable set paid = v_new_paid, status = v_status where id = v_ap;
  return jsonb_build_object('payable_id', v_ap, 'paid', v_new_paid,
                            'amount', v_amount, 'status', v_status);
end $$;

-- ── cash_session_summary: incluye ventas 'devuelta' en el efectivo recibido [#3]
-- Antes, una venta totalmente devuelta dejaba de contar en v_efe (filtro
-- status='completada') Y además se restaba vía v_ref → doble resta → efectivo
-- esperado subvaluado/negativo. Ahora v_efe/v_tickets/v_total incluyen 'devuelta'
-- y v_ref resta el reembolso una sola vez.
create or replace function cash_session_summary(p_session uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_suc uuid; v_open bigint; v_status text;
  v_efe bigint; v_tar bigint; v_tra bigint; v_cre bigint;
  v_in bigint; v_out bigint; v_ref bigint; v_tickets int; v_total bigint;
  v_expected bigint;
begin
  select sucursal_id, opening_amount, status
    into v_suc, v_open, v_status
  from cash_sessions where id = p_session;
  if v_suc is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;

  select
    coalesce(sum(sp.amount) filter (where sp.method = 'efectivo'), 0),
    coalesce(sum(sp.amount) filter (where sp.method = 'tarjeta'), 0),
    coalesce(sum(sp.amount) filter (where sp.method = 'transferencia'), 0),
    coalesce(sum(sp.amount) filter (where sp.method = 'credito'), 0)
  into v_efe, v_tar, v_tra, v_cre
  from sale_payments sp
  join sales s on s.id = sp.sale_id
  where s.cash_session_id = p_session and s.status in ('completada','devuelta');

  select coalesce(count(*), 0), coalesce(sum(total), 0)
  into v_tickets, v_total
  from sales where cash_session_id = p_session and status in ('completada','devuelta');

  select coalesce(sum(amount) filter (where kind = 'ingreso'), 0),
         coalesce(sum(amount) filter (where kind = 'retiro'), 0)
  into v_in, v_out
  from cash_movements where cash_session_id = p_session;

  select coalesce(sum(r.total), 0) into v_ref
  from returns r
  join sales s on s.id = r.sale_id
  where s.cash_session_id = p_session and r.refund_method = 'efectivo'
    and r.created_at <= coalesce(
      (select closed_at from cash_sessions where id = p_session), now());

  v_expected := v_open + v_efe + v_in - v_out - v_ref;

  return jsonb_build_object(
    'session_id', p_session, 'status', v_status,
    'opening_amount', v_open,
    'by_method', jsonb_build_object(
      'efectivo', v_efe, 'tarjeta', v_tar,
      'transferencia', v_tra, 'credito', v_cre),
    'cash_in', v_in, 'cash_out', v_out, 'cash_refunds', v_ref,
    'ticket_count', v_tickets, 'sales_total', v_total,
    'expected_cash', v_expected);
end $$;

-- ── Vistas: defensa extra y limpieza ─────────────────────────────────────────
-- v_sales_daily: el CTE de devoluciones excluye devoluciones de ventas canceladas
-- (defensa; hoy cancel_sale ya rechaza ventas con devoluciones). [#4]
drop view if exists v_sales_daily;
create view v_sales_daily as
with s as (
  select sucursal_id, date_trunc('day', created_at) as day,
         count(*) filter (where status in ('completada','devuelta')) as ventas,
         coalesce(sum(total) filter (where status in ('completada','devuelta')), 0) as gross,
         coalesce(sum(tax_total) filter (where status in ('completada','devuelta')), 0) as gross_iva
  from sales
  group by sucursal_id, date_trunc('day', created_at)
),
r as (
  select rr.sucursal_id, date_trunc('day', rr.created_at) as day,
         coalesce(sum(rr.total), 0) as refund,
         coalesce(sum(round(ri.refund_amount * si.tax_rate
                            / (1 + si.tax_rate))), 0) as refund_iva
  from returns rr
  join sales sx on sx.id = rr.sale_id and sx.status <> 'cancelada'
  join return_items ri on ri.return_id = rr.id
  join sale_items si on si.id = ri.sale_item_id
  group by rr.sucursal_id, date_trunc('day', rr.created_at)
)
select coalesce(s.sucursal_id, r.sucursal_id) as sucursal_id,
       coalesce(s.day, r.day) as day,
       coalesce(s.ventas, 0) as ventas,
       (coalesce(s.gross, 0) - coalesce(r.refund, 0))::bigint as total,
       (coalesce(s.gross_iva, 0) - coalesce(r.refund_iva, 0))::bigint as iva
from s
full outer join r on s.sucursal_id = r.sucursal_id and s.day = r.day;

-- v_top_products: excluye productos con cantidad neta <= 0 (no distorsiona la
-- heurística de baja rotación). [#12]
drop view if exists v_top_products;
create view v_top_products as
select sucursal_id, product_id, name, qty_sold, revenue
from (
  with sold as (
    select si.sucursal_id, si.product_id, p.name,
           sum(si.quantity) as qty, sum(si.line_total) as rev
    from sale_items si
    join sales s on s.id = si.sale_id and s.status in ('completada','devuelta')
    join products p on p.id = si.product_id
    group by si.sucursal_id, si.product_id, p.name
  ),
  ret as (
    select si.sucursal_id, si.product_id,
           sum(ri.quantity) as qty, sum(ri.refund_amount) as amt
    from return_items ri
    join sale_items si on si.id = ri.sale_item_id
    join sales sx on sx.id = si.sale_id and sx.status <> 'cancelada'
    group by si.sucursal_id, si.product_id
  )
  select sold.sucursal_id, sold.product_id, sold.name,
         (sold.qty - coalesce(ret.qty, 0)) as qty_sold,
         (sold.rev - coalesce(ret.amt, 0))::bigint as revenue
  from sold
  left join ret on ret.sucursal_id = sold.sucursal_id
               and ret.product_id = sold.product_id
) t
where t.qty_sold > 0;

do $$ begin
  alter view v_sales_daily  set (security_invoker = true);
  alter view v_top_products set (security_invoker = true);
exception when others then null; end $$;
