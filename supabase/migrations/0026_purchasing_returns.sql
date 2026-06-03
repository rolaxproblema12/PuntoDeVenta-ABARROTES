-- 0026_purchasing_returns: recepción de mercancía con CxP (P1), subsistema de
-- devoluciones (P3) y neteo de devoluciones en reportes (A-4). No edita
-- migraciones aplicadas. Modelo IVA-INCLUIDO; centavos (bigint).

-- ── receive_goods: recepción ATÓMICA con lote, costo y cuenta por pagar ───────
-- Antes la web insertaba inventory_movements en un bucle de inserts sueltos: sin
-- atomicidad (recepción parcial sin rollback), sin lote FIFO, y SIN reconocer el
-- pasivo (la compra a crédito jamás generaba accounts_payable → CxP siempre vacío).
-- Ahora, en una sola transacción: crea lote + movimiento 'entrada' por línea
-- (exige unit_cost > 0), y si es a crédito crea la cuenta por pagar al proveedor
-- con vencimiento según terms_days.                                        [A-3,M-5,M-7]
create or replace function receive_goods(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suc    uuid    := (p_payload->>'sucursal_id')::uuid;
  v_sup    uuid    := nullif(p_payload->>'supplier_id', '')::uuid;
  v_credit boolean := coalesce((p_payload->>'on_credit')::boolean, false);
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

    -- Lote (reabastece FIFO) + movimiento de entrada (el trigger ajusta stock y avg_cost).
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

  -- Compra a crédito → reconoce el pasivo (cuenta por pagar).
  if v_credit then
    if v_sup is null then
      raise exception 'SUPPLIER_REQUIRED: la compra a crédito requiere proveedor'
        using errcode = 'check_violation';
    end if;
    select coalesce(terms_days, 0) into v_terms from suppliers where id = v_sup;
    insert into accounts_payable (sucursal_id, supplier_id, amount, paid, due_date, status)
    values (v_suc, v_sup, v_total, 0,
            current_date + coalesce(v_terms, 0), 'pendiente')
    returning id into v_ap;
  end if;

  return jsonb_build_object('items', v_count, 'total', v_total,
                            'on_credit', v_credit, 'payable_id', v_ap);
end $$;

-- ── register_return: devolución ATÓMICA con reembolso proporcional ────────────
-- No existía operación de devoluciones (createReturnSchema no llegaba a ningún
-- handler). Ahora calcula el reembolso proporcional con IVA CONTENIDO sobre el
-- line_total, valida que no exceda lo vendido (menos lo ya devuelto), reingresa
-- el inventario, y reembolsa: a crédito → abono; en efectivo → cash_session_summary
-- ya lo resta del efectivo esperado de la sesión original. Marca 'devuelta' solo
-- si la venta quedó completamente devuelta. Idempotente por client_op_id.    [C-2,A-4]
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
  v_avg bigint; v_lot uuid;
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
    select id, product_id, quantity, line_total, tax_rate, kind
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

    -- Reembolso proporcional (IVA incluido) e IVA contenido devuelto.
    v_refund := round(v_si.line_total * v_qty / v_si.quantity);
    v_tax := round(v_refund * coalesce(v_si.tax_rate, 0)
                   / (1 + coalesce(v_si.tax_rate, 0)));
    v_total_refund := v_total_refund + v_refund;
    v_tax_refund := v_tax_refund + v_tax;

    insert into return_items (return_id, sale_item_id, quantity, refund_amount)
    values (v_ret, v_si.id, v_qty, v_refund);

    -- Reingreso de inventario (producto físico) al costo promedio actual.
    if v_si.kind = 'producto' and v_si.product_id is not null then
      select coalesce(avg_cost, 0) into v_avg from branch_stock
        where product_id = v_si.product_id and sucursal_id = v_suc;
      v_avg := coalesce(v_avg, 0);
      insert into lots (product_id, sucursal_id, lot_code, qty_received,
                        qty_remaining, cost)
      values (v_si.product_id, v_suc, 'RET-' || left(v_ret::text, 8),
              v_qty, v_qty, v_avg)
      returning id into v_lot;
      insert into inventory_movements (sucursal_id, product_id, lot_id, kind,
                                       quantity, unit_cost, ref_type, ref_id,
                                       created_by)
      values (v_suc, v_si.product_id, v_lot, 'devolucion', v_qty, v_avg,
              'return', v_ret, auth.uid());
    end if;
  end loop;

  if v_total_refund <= 0 then
    raise exception 'EMPTY_RETURN: la devolución no tiene monto'
      using errcode = 'check_violation';
  end if;

  update returns set total = v_total_refund where id = v_ret;

  -- Reembolso a crédito → abona (reduce la deuda). Efectivo/tarjeta/transferencia:
  -- el efectivo lo resta cash_session_summary; tarjeta/transferencia es reversa externa.
  if v_method = 'credito' then
    if v_cust is null then
      raise exception 'CREDIT_NO_CUSTOMER' using errcode = 'check_violation';
    end if;
    insert into customer_credit_movements (customer_id, sucursal_id, kind,
                                           amount, sale_id, created_by)
    values (v_cust, v_suc, 'abono', v_total_refund, v_sale, auth.uid());
  end if;

  -- 'devuelta' solo si TODOS los ítems quedaron completamente devueltos.
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

-- ── replay_sync_op: ahora despacha las tres operaciones offline ──────────────
create or replace function replay_sync_op(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_type text := p_payload->>'op_type';
  v_p    jsonb := p_payload->'payload';
begin
  if v_type = 'sale.create' then
    return register_sale(v_p);
  elsif v_type = 'sale.cancel' then
    return cancel_sale((v_p->>'sale_id')::uuid, v_p->>'reason');
  elsif v_type = 'return.create' then
    return register_return(v_p);
  end if;
  raise exception 'UNSUPPORTED_OP: %', v_type using errcode = 'feature_not_supported';
end $$;

-- ── Vistas de reportes NETEADAS por devoluciones ─────────────────────────────
-- v_sales_daily y v_top_products restaban devoluciones = 0. Ahora netean el
-- reembolso (y su IVA contenido) por el día/producto correspondiente. Se incluye
-- 'devuelta' en el bruto y se resta el reembolso → una venta totalmente devuelta
-- neto = 0; las canceladas siguen excluidas.                                    [A-4]
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

drop view if exists v_top_products;
create view v_top_products as
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
  group by si.sucursal_id, si.product_id
)
select sold.sucursal_id, sold.product_id, sold.name,
       (sold.qty - coalesce(ret.qty, 0)) as qty_sold,
       (sold.rev - coalesce(ret.amt, 0))::bigint as revenue
from sold
left join ret on ret.sucursal_id = sold.sucursal_id
             and ret.product_id = sold.product_id;

do $$ begin
  alter view v_sales_daily  set (security_invoker = true);
  alter view v_top_products set (security_invoker = true);
exception when others then null; end $$;
