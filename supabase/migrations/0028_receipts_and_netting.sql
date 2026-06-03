-- 0028_receipts_and_netting: cierra los 2 hallazgos restantes de la revisión.
--  [#10] La recepción (contado o crédito) ahora deja un encabezado trazable por
--        proveedor (goods_receipts) + sus líneas (goods_receipt_items), y los
--        movimientos de inventario apuntan a ese recibo (ref_id).
--  [#13] El neteo de devoluciones se imputa al DÍA DE LA VENTA original (no al de
--        la devolución) → sin barras negativas en días sin ventas; y se corrige un
--        sobreconteo: el reembolso del día se suma por ítem (ri.refund_amount), no
--        sum(returns.total) que se multiplicaba al unir con return_items.
-- No edita migraciones aplicadas.

-- ── goods_receipts: admite recepción sin orden de compra y guarda el proveedor ─
alter table goods_receipts alter column po_id drop not null;
alter table goods_receipts add column if not exists supplier_id uuid references suppliers(id);

-- ── receive_goods: crea encabezado + líneas de recepción (trazabilidad) ──────
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
  v_gr     uuid;
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

  -- Encabezado de recepción (sin orden de compra). Guarda el proveedor aunque sea
  -- compra de contado, para reportes de compras por proveedor.
  insert into goods_receipts (po_id, sucursal_id, supplier_id, created_by)
  values (null, v_suc, v_sup, auth.uid())
  returning id into v_gr;

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
                                     quantity, unit_cost, ref_type, ref_id, created_by)
    values (v_suc, v_prod, v_lot, 'entrada', v_qty, v_cost, 'compra', v_gr, auth.uid());

    insert into goods_receipt_items (goods_receipt_id, product_id, qty_received,
                                     unit_cost, lot_id)
    values (v_gr, v_prod, v_qty, v_cost, v_lot);

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

  v_existing := jsonb_build_object('receipt_id', v_gr, 'items', v_count,
                                   'total', v_total, 'on_credit', v_credit,
                                   'payable_id', v_ap);

  if v_op is not null then
    insert into sync_queue (sucursal_id, client_op_id, op_type, payload,
                            status, result, applied_at)
    values (v_suc, v_op, 'purchase.receive', p_payload, 'applied', v_existing, now())
    on conflict (client_op_id) do update
      set status = 'applied', result = excluded.result, applied_at = now();
  end if;

  return v_existing;
end $$;

-- ── v_sales_daily: neteo imputado al día de la VENTA + fix de sobreconteo ─────
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
  -- Imputa el reembolso al día/sucursal de la VENTA original (sx.created_at), y
  -- suma POR ÍTEM (ri.refund_amount) para no multiplicar el total de la devolución
  -- cuando tiene varias líneas. Excluye ventas canceladas.
  select sx.sucursal_id, date_trunc('day', sx.created_at) as day,
         coalesce(sum(ri.refund_amount), 0) as refund,
         coalesce(sum(round(ri.refund_amount * si.tax_rate
                            / (1 + si.tax_rate))), 0) as refund_iva
  from returns rr
  join sales sx on sx.id = rr.sale_id and sx.status <> 'cancelada'
  join return_items ri on ri.return_id = rr.id
  join sale_items si on si.id = ri.sale_item_id
  group by sx.sucursal_id, date_trunc('day', sx.created_at)
)
select coalesce(s.sucursal_id, r.sucursal_id) as sucursal_id,
       coalesce(s.day, r.day) as day,
       coalesce(s.ventas, 0) as ventas,
       (coalesce(s.gross, 0) - coalesce(r.refund, 0))::bigint as total,
       (coalesce(s.gross_iva, 0) - coalesce(r.refund_iva, 0))::bigint as iva
from s
full outer join r on s.sucursal_id = r.sucursal_id and s.day = r.day;

do $$ begin
  alter view v_sales_daily set (security_invoker = true);
exception when others then null; end $$;
