-- 0024_fix_register_sale_iva: corrige la doble aplicación de IVA en register_sale.
--
-- El modelo de precios es IVA-INCLUIDO (ver packages/shared/src/schemas/sale.ts):
-- el POS, el carrito y la validación zod tratan `unit_price` como el monto final
-- a cobrar y NO suman impuesto. La versión previa de register_sale (0010_rpcs.sql)
-- calculaba el IVA sobre ese precio y lo AGREGABA al total → un producto de $50
-- @16% se cobraba como $58.
--
-- Arreglo: el total = suma de líneas brutas + propina (lo que muestra el POS).
-- El IVA se EXTRAE como porción contenida —  v_line_tax = round(v_line*r/(1+r)) —
-- para que `tax_total` siga siendo el IVA real desglosado (facturación/reportes),
-- manteniendo el invariante  total = subtotal + tax_total + tip.
--   $50 @16%: tax = round(5000*0.16/1.16)=690, base=4310, total=4310+690=5000 ✓
--
-- Solo cambian el loop de items (cálculo de v_sub/v_tax) y nada más; el resto del
-- cuerpo es idéntico a 0010_rpcs.sql. No se edita la migración aplicada: se redefine.

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
  v_rate     numeric;
  v_line_tax bigint;
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
    -- v_line = total bruto de la línea (precio − descuento) × cantidad, IVA incluido.
    v_line := round(((v_item->>'unit_price')::bigint
                     - coalesce((v_item->>'discount')::bigint,0))
                    * (v_item->>'quantity')::numeric);
    v_disc := v_disc + round(coalesce((v_item->>'discount')::bigint,0)
                             * (v_item->>'quantity')::numeric);

    -- IVA CONTENIDO en el bruto (no agregado encima):  bruto * r / (1 + r).
    v_rate     := coalesce((v_item->>'tax_rate')::numeric, 0);
    v_line_tax := round(v_line * v_rate / (1 + v_rate));

    v_sub := v_sub + (v_line - v_line_tax);  -- base gravable
    v_tax := v_tax + v_line_tax;             -- IVA desglosado

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

  -- total = base + IVA contenido + propina = suma de líneas brutas + propina.
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
