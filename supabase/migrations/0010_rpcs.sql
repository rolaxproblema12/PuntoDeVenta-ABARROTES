-- 0010_rpcs: funciones transaccionales. Toda escritura multi-tabla del POS
-- ocurre dentro de UNA función → atómica. La API nunca encadena escrituras.

-- ── FIFO: consume el lote más viejo no vencido ───────────────────────────────
create or replace function fifo_consume_lots(
  p_product uuid, p_sucursal uuid, p_qty numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rem numeric := p_qty;
  v_lot record;
begin
  for v_lot in
    select id, qty_remaining from lots
    where product_id = p_product and sucursal_id = p_sucursal
      and qty_remaining > 0
      and (expiry_date is null or expiry_date >= current_date)
    order by expiry_date nulls last, received_at
    for update
  loop
    exit when v_rem <= 0;
    if v_lot.qty_remaining >= v_rem then
      update lots set qty_remaining = qty_remaining - v_rem where id = v_lot.id;
      v_rem := 0;
    else
      update lots set qty_remaining = 0 where id = v_lot.id;
      v_rem := v_rem - v_lot.qty_remaining;
    end if;
  end loop;
  -- Si no hay lotes (producto sin track_lots) no es error: el control de
  -- stock real lo hace branch_stock vía trigger.
end $$;

-- ── Verifica límite de crédito ───────────────────────────────────────────────
create or replace function assert_credit_available(
  p_customer uuid, p_amount bigint
) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_lim bigint; v_bal bigint;
begin
  select credit_limit, current_balance into v_lim, v_bal
  from customers where id = p_customer;
  if v_lim is null then
    raise exception 'CREDIT_NO_CUSTOMER' using errcode = 'foreign_key_violation';
  end if;
  if v_bal + p_amount > v_lim then
    raise exception 'CREDIT_LIMIT: límite % excedido (saldo % + % )',
      v_lim, v_bal, p_amount using errcode = 'check_violation';
  end if;
end $$;

-- ── Recalcula precios/promos server-side (stub Fase 0: passthrough) ──────────
create or replace function apply_promotions(p_cart jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  -- Fase 3 implementará promos/mayoreo. Hoy devuelve el carrito tal cual.
  return p_cart;
end $$;

-- ── register_sale: venta atómica + idempotente ───────────────────────────────
create or replace function register_sale(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_op       uuid := (p_payload->>'client_op_id')::uuid;
  v_suc      uuid := (p_payload->>'sucursal_id')::uuid;
  v_reg      uuid := (p_payload->>'register_id')::uuid;
  v_cs       uuid := (p_payload->>'cash_session_id')::uuid;
  v_cust     uuid := nullif(p_payload->>'customer_id','')::uuid;
  v_tip      bigint := coalesce((p_payload->>'tip')::bigint, 0);
  v_existing jsonb;
  v_sale     uuid;
  v_folio    text;
  v_item     jsonb;
  v_pay      jsonb;
  v_sub      bigint := 0;
  v_tax      bigint := 0;
  v_disc     bigint := 0;
  v_total    bigint := 0;
  v_paid     bigint := 0;
  v_method   text;
  v_line     bigint;
begin
  -- Idempotencia: si ya se aplicó esta op, devuelve el resultado previo.
  select result into v_existing from sync_queue
    where client_op_id = v_op and status = 'applied';
  if v_existing is not null then
    return v_existing;
  end if;

  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from cash_sessions
                 where id = v_cs and register_id = v_reg
                   and sucursal_id = v_suc and status = 'open') then
    raise exception 'CASH_SESSION_CLOSED' using errcode = 'check_violation';
  end if;

  v_folio := next_folio(v_suc, 'sale');

  insert into sales (sucursal_id, folio, register_id, cash_session_id,
                     customer_id, payment_method, status, tip, created_by)
  values (v_suc, v_folio, v_reg, v_cs, v_cust, 'efectivo', 'completada',
          v_tip, auth.uid())
  returning id into v_sale;

  for v_item in select * from jsonb_array_elements(p_payload->'items')
  loop
    v_line := round(((v_item->>'unit_price')::bigint
                     - coalesce((v_item->>'discount')::bigint,0))
                    * (v_item->>'quantity')::numeric);
    v_sub  := v_sub  + v_line;
    v_disc := v_disc + round(coalesce((v_item->>'discount')::bigint,0)
                             * (v_item->>'quantity')::numeric);
    v_tax  := v_tax  + round(v_line * coalesce((v_item->>'tax_rate')::numeric,0));

    insert into sale_items (sale_id, sucursal_id, product_id, variant_id, kind,
                            description, quantity, unit, unit_price, unit_cost,
                            tax_rate, discount, line_total)
    values (v_sale, v_suc,
            nullif(v_item->>'product_id','')::uuid,
            nullif(v_item->>'variant_id','')::uuid,
            coalesce(v_item->>'kind','producto'),
            v_item->>'description',
            (v_item->>'quantity')::numeric,
            coalesce(v_item->>'unit','pieza'),
            (v_item->>'unit_price')::bigint,
            coalesce((v_item->>'unit_cost')::bigint,0),
            coalesce((v_item->>'tax_rate')::numeric,0),
            coalesce((v_item->>'discount')::bigint,0),
            v_line);

    -- Descuento de inventario solo para productos físicos.
    if coalesce(v_item->>'kind','producto') = 'producto'
       and nullif(v_item->>'product_id','') is not null then
      insert into inventory_movements (sucursal_id, product_id, kind, quantity,
                                       unit_cost, ref_type, ref_id, created_by)
      values (v_suc, (v_item->>'product_id')::uuid, 'venta',
              -((v_item->>'quantity')::numeric),
              coalesce((v_item->>'unit_cost')::bigint,0),
              'sale', v_sale, auth.uid());
      perform fifo_consume_lots((v_item->>'product_id')::uuid, v_suc,
                                (v_item->>'quantity')::numeric);
    end if;
  end loop;

  v_total := v_sub + v_tax + v_tip;

  for v_pay in select * from jsonb_array_elements(p_payload->'payments')
  loop
    v_method := v_pay->>'method';
    v_paid := v_paid + (v_pay->>'amount')::bigint;
    insert into sale_payments (sale_id, sucursal_id, method, amount, reference)
    values (v_sale, v_suc, v_method, (v_pay->>'amount')::bigint,
            nullif(v_pay->>'reference',''));

    if v_method = 'credito' then
      if v_cust is null then
        raise exception 'CREDIT_NO_CUSTOMER' using errcode = 'check_violation';
      end if;
      perform assert_credit_available(v_cust, (v_pay->>'amount')::bigint);
      insert into customer_credit_movements (customer_id, sucursal_id, kind,
                                             amount, sale_id, created_by)
      values (v_cust, v_suc, 'cargo', (v_pay->>'amount')::bigint,
              v_sale, auth.uid());
    end if;
  end loop;

  update sales
  set subtotal = v_sub, tax_total = v_tax, discount_total = v_disc,
      total = v_total,
      payment_method = case
        when (select count(distinct method) from sale_payments
              where sale_id = v_sale) > 1 then 'mixto'
        else (select method from sale_payments
              where sale_id = v_sale limit 1) end
  where id = v_sale;

  v_existing := jsonb_build_object(
    'sale_id', v_sale, 'folio', v_folio,
    'total', v_total, 'change', greatest(v_paid - v_total, 0));

  insert into sync_queue (sucursal_id, client_op_id, op_type, payload,
                          status, result, applied_at)
  values (v_suc, v_op, 'sale.create', p_payload, 'applied', v_existing, now())
  on conflict (client_op_id) do update
    set status = 'applied', result = excluded.result, applied_at = now();

  return v_existing;
end $$;

-- ── replay_sync_op: punto de entrada idempotente para cola offline ───────────
create or replace function replay_sync_op(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_type text := p_payload->>'op_type';
begin
  if v_type = 'sale.create' then
    return register_sale(p_payload->'payload');
  end if;
  raise exception 'UNSUPPORTED_OP: %', v_type using errcode = 'feature_not_supported';
end $$;
