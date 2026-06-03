-- 0025_accounting_hardening: cierra los defectos contables P0/P2 de la auditoría
-- (docs/auditoria-contabilidad-2026-06-03.md). No edita migraciones aplicadas:
-- redefine register_sale (create or replace) y agrega cancel_sale y
-- register_credit_payment. Modelo de precios IVA-INCLUIDO; centavos (bigint).

-- ── register_sale: venta atómica, idempotente y SEGURA ANTE CONCURRENCIA ──────
-- Cambios vs 0024:
--  * Advisory lock por client_op_id → dos ejecuciones concurrentes de la misma op
--    se serializan; la segunda ve la fila 'applied' y devuelve el resultado previo
--    (antes ambas pasaban el SELECT y duplicaban venta/stock/crédito).  [A-1]
--  * COGS server-side: unit_cost = costo promedio actual (branch_stock.avg_cost);
--    se IGNORA el unit_cost del cliente (manipulable / 0 sin precio).            [M-6]
--  * Crédito = SOLO el residuo no cubierto por otros métodos; revalida el límite
--    con la fila del cliente bloqueada (FOR UPDATE) → no excede el límite en
--    carrera ni sobrecarga la deuda; el vuelto se calcula solo con efectivo.  [M-2,M-3,B-1]
--  * Rechaza method='mixto' por línea (solo es descriptor de cabecera).         [M-4]
--  * Valida discount <= unit_price y total > 0.                                  [M-1]
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
  v_paid_nc  bigint := 0;   -- pagos NO crédito (efectivo/tarjeta/transferencia)
  v_paid     bigint := 0;
  v_change   bigint := 0;
  v_method   text;
  v_amt      bigint;
  v_line     bigint;
  v_rate     numeric;
  v_line_tax bigint;
  v_cogs     bigint;
  v_price    bigint;
  v_dunit    bigint;
  v_qty      numeric;
  v_has_credit boolean := false;
  v_credit_ref text;
  v_residual bigint;
  v_bal      bigint;
  v_lim      bigint;
begin
  -- Serializa operaciones con el mismo client_op_id (anti doble-venta concurrente).
  perform pg_advisory_xact_lock(hashtextextended(v_op::text, 0));

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
    v_price := (v_item->>'unit_price')::bigint;
    v_dunit := coalesce((v_item->>'discount')::bigint, 0);
    v_qty   := (v_item->>'quantity')::numeric;
    if v_dunit > v_price then
      raise exception 'BAD_DISCOUNT: descuento % excede el precio %', v_dunit, v_price
        using errcode = 'check_violation';
    end if;

    -- Total bruto de la línea (precio − descuento) × cantidad, IVA incluido.
    v_line := round((v_price - v_dunit) * v_qty);
    v_disc := v_disc + round(v_dunit * v_qty);

    -- IVA CONTENIDO (no agregado): bruto * r/(1+r). base = bruto − iva.
    v_rate     := coalesce((v_item->>'tax_rate')::numeric, 0);
    v_line_tax := round(v_line * v_rate / (1 + v_rate));
    v_sub := v_sub + (v_line - v_line_tax);
    v_tax := v_tax + v_line_tax;

    -- COGS server-side: costo promedio actual (ignora el unit_cost del cliente).
    v_cogs := 0;
    if coalesce(v_item->>'kind','producto') = 'producto'
       and nullif(v_item->>'product_id','') is not null then
      select coalesce(avg_cost, 0) into v_cogs from branch_stock
        where product_id = (v_item->>'product_id')::uuid and sucursal_id = v_suc;
      v_cogs := coalesce(v_cogs, 0);
    end if;

    insert into sale_items (sale_id, sucursal_id, product_id, variant_id, kind,
                            description, quantity, unit, unit_price, unit_cost,
                            tax_rate, discount, line_total)
    values (v_sale, v_suc,
            nullif(v_item->>'product_id','')::uuid,
            nullif(v_item->>'variant_id','')::uuid,
            coalesce(v_item->>'kind','producto'),
            v_item->>'description',
            v_qty,
            coalesce(v_item->>'unit','pieza'),
            v_price,
            v_cogs,
            v_rate,
            v_dunit,
            v_line);

    -- Descuento de inventario solo para productos físicos.
    if coalesce(v_item->>'kind','producto') = 'producto'
       and nullif(v_item->>'product_id','') is not null then
      insert into inventory_movements (sucursal_id, product_id, kind, quantity,
                                       unit_cost, ref_type, ref_id, created_by)
      values (v_suc, (v_item->>'product_id')::uuid, 'venta',
              -v_qty, v_cogs, 'sale', v_sale, auth.uid());
      perform fifo_consume_lots((v_item->>'product_id')::uuid, v_suc, v_qty);
    end if;
  end loop;

  v_total := v_sub + v_tax + v_tip;
  if v_total <= 0 then
    raise exception 'BAD_TOTAL: el total de la venta debe ser mayor a 0'
      using errcode = 'check_violation';
  end if;

  -- Pagos: procesa primero los NO-crédito y suma; el crédito cubre solo el residuo.
  for v_pay in select * from jsonb_array_elements(p_payload->'payments')
  loop
    v_method := v_pay->>'method';
    if v_method = 'mixto' then
      raise exception 'BAD_PAYMENT_METHOD: ''mixto'' no es un método de línea de pago'
        using errcode = 'check_violation';
    end if;
    if v_method = 'credito' then
      v_has_credit := true;
      v_credit_ref := coalesce(v_credit_ref, nullif(v_pay->>'reference',''));
    else
      v_amt := (v_pay->>'amount')::bigint;
      if v_amt < 0 then
        raise exception 'BAD_AMOUNT' using errcode = 'check_violation';
      end if;
      v_paid_nc := v_paid_nc + v_amt;
      insert into sale_payments (sale_id, sucursal_id, method, amount, reference)
      values (v_sale, v_suc, v_method, v_amt, nullif(v_pay->>'reference',''));
    end if;
  end loop;

  if v_has_credit then
    if v_cust is null then
      raise exception 'CREDIT_NO_CUSTOMER' using errcode = 'check_violation';
    end if;
    v_residual := v_total - v_paid_nc;
    if v_residual <= 0 then
      raise exception 'CREDIT_NOT_NEEDED: los pagos ya cubren el total'
        using errcode = 'check_violation';
    end if;
    -- Bloquea al cliente y revalida el límite con la fila bloqueada (anti carrera).
    select current_balance, credit_limit into v_bal, v_lim
      from customers where id = v_cust and sucursal_id = v_suc for update;
    if v_lim is null then
      raise exception 'CREDIT_NO_CUSTOMER' using errcode = 'foreign_key_violation';
    end if;
    if v_bal + v_residual > v_lim then
      raise exception 'CREDIT_LIMIT: límite % excedido (saldo % + %)',
        v_lim, v_bal, v_residual using errcode = 'check_violation';
    end if;
    insert into sale_payments (sale_id, sucursal_id, method, amount, reference)
    values (v_sale, v_suc, 'credito', v_residual, v_credit_ref);
    insert into customer_credit_movements (customer_id, sucursal_id, kind,
                                           amount, sale_id, created_by)
    values (v_cust, v_suc, 'cargo', v_residual, v_sale, auth.uid());
    v_paid   := v_paid_nc + v_residual;   -- = v_total
    v_change := 0;                          -- un cargo a crédito nunca da vuelto
  else
    v_paid := v_paid_nc;
    if v_paid < v_total then
      raise exception 'PAYMENT_INSUFFICIENT: los pagos no cubren el total'
        using errcode = 'check_violation';
    end if;
    v_change := v_paid - v_total;           -- vuelto solo de efectivo/tarjeta
  end if;

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
    'total', v_total, 'change', v_change);

  insert into sync_queue (sucursal_id, client_op_id, op_type, payload,
                          status, result, applied_at)
  values (v_suc, v_op, 'sale.create', p_payload, 'applied', v_existing, now())
  on conflict (client_op_id) do update
    set status = 'applied', result = excluded.result, applied_at = now();

  return v_existing;
end $$;

-- ── cancel_sale: cancelación ATÓMICA con reversa real ────────────────────────
-- Antes la API solo hacía UPDATE sales SET status='cancelada' (sin reversa), por
-- lo que el stock, los lotes y el cargo a crédito quedaban corruptos para siempre.
-- Ahora, en una sola transacción: reingresa el inventario (movimiento 'devolucion'
-- + lote de reposición al costo promedio → neutral al avg_cost), abona el cargo de
-- crédito si lo hubo, y marca la venta cancelada. Idempotente. El efectivo se
-- autocorrige porque el corte filtra status='completada'.                    [C-1,A-7]
create or replace function cancel_sale(p_sale_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suc uuid; v_status text; v_cust uuid;
  v_item record; v_avg bigint; v_lot uuid; v_credit bigint;
begin
  select sucursal_id, status, customer_id
    into v_suc, v_status, v_cust
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

  -- Reingreso de inventario por cada ítem físico.
  for v_item in
    select product_id, quantity from sale_items
    where sale_id = p_sale_id and kind = 'producto' and product_id is not null
  loop
    select coalesce(avg_cost, 0) into v_avg from branch_stock
      where product_id = v_item.product_id and sucursal_id = v_suc;
    v_avg := coalesce(v_avg, 0);
    insert into lots (product_id, sucursal_id, lot_code, qty_received,
                      qty_remaining, cost)
    values (v_item.product_id, v_suc, 'CANCEL-' || left(p_sale_id::text, 8),
            v_item.quantity, v_item.quantity, v_avg)
    returning id into v_lot;
    insert into inventory_movements (sucursal_id, product_id, lot_id, kind,
                                     quantity, unit_cost, ref_type, ref_id,
                                     created_by)
    values (v_suc, v_item.product_id, v_lot, 'devolucion',
            v_item.quantity, v_avg, 'sale_cancel', p_sale_id, auth.uid());
  end loop;

  -- Reversa del cargo a crédito (si lo hubo): abono compensatorio.
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

-- ── register_credit_payment: abono de crédito atómico con tope ───────────────
-- Antes la web insertaba el abono directo en customer_credit_movements sin validar
-- contra el saldo: un sobrepago dejaba current_balance negativo e inflaba el crédito
-- disponible. Ahora valida amount <= saldo (con la fila bloqueada) e inserta atómico.
-- (Las reversas de cancelación/devolución sí pueden generar saldo a favor legítimo;
--  esta función es solo para abonos manuales de mostrador.)                      [A-5]
create or replace function register_credit_payment(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cust uuid   := (p_payload->>'customer_id')::uuid;
  v_suc  uuid   := (p_payload->>'sucursal_id')::uuid;
  v_amt  bigint := nullif(p_payload->>'amount', '')::bigint;
  v_note text   := nullif(trim(p_payload->>'note'), '');
  v_bal  bigint;
begin
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if v_amt is null or v_amt <= 0 then
    raise exception 'BAD_AMOUNT: el abono debe ser mayor a 0'
      using errcode = 'check_violation';
  end if;
  select current_balance into v_bal from customers
    where id = v_cust and sucursal_id = v_suc for update;
  if v_bal is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if v_amt > v_bal then
    raise exception 'ABONO_EXCEEDS_BALANCE: el abono % excede el saldo % del cliente',
      v_amt, v_bal using errcode = 'check_violation';
  end if;

  insert into customer_credit_movements (customer_id, sucursal_id, kind,
                                         amount, note, created_by)
  values (v_cust, v_suc, 'abono', v_amt, coalesce(v_note, 'Abono en mostrador'),
          auth.uid());

  select current_balance into v_bal from customers where id = v_cust;
  return jsonb_build_object('customer_id', v_cust, 'amount', v_amt, 'balance', v_bal);
end $$;
