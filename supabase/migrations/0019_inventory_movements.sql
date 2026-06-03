-- 0019_inventory_movements: entrada con costo/lote/caducidad, ajuste a conteo
-- físico (delta con signo) y merma/salida con costo promedio. Toda la escritura
-- multi-tabla ocurre dentro de UNA función → atómica. Idempotente.

-- ── record_stock_movement: movimiento de inventario manual y atómico ─────────
create or replace function record_stock_movement(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suc    uuid    := (p_payload->>'sucursal_id')::uuid;
  v_prod   uuid    := (p_payload->>'product_id')::uuid;
  v_kind   text    := p_payload->>'kind';
  v_reason text    := nullif(trim(p_payload->>'reason'), '');
  v_qty    numeric := nullif(p_payload->>'quantity', '')::numeric;
  v_target numeric := nullif(p_payload->>'target_qty', '')::numeric;
  v_ucost  bigint  := nullif(p_payload->>'unit_cost', '')::bigint;
  v_lotc   text    := nullif(p_payload->>'lot_code', '');
  v_exp    date    := nullif(p_payload->>'expiry_date', '')::date;
  v_cur    numeric;
  v_avg    bigint;
  v_signed numeric;
  v_lot    uuid;
  v_new    numeric;
begin
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if v_prod is null or v_kind is null then
    raise exception 'BAD_REQUEST: product_id/kind requeridos'
      using errcode = 'check_violation';
  end if;
  -- Aislamiento: el producto debe pertenecer a la sucursal indicada (evita
  -- inyectar product_id de otra sucursal aprovechando el SECURITY DEFINER).
  if not exists (select 1 from products
                 where id = v_prod and sucursal_id = v_suc) then
    raise exception 'PRODUCT_NOT_IN_SUCURSAL'
      using errcode = 'insufficient_privilege';
  end if;
  if v_ucost is not null and v_ucost < 0 then
    raise exception 'BAD_COST: unit_cost no puede ser negativo'
      using errcode = 'check_violation';
  end if;

  -- Stock y costo promedio actuales (0 si el producto nunca tuvo movimientos).
  select stock, avg_cost into v_cur, v_avg
  from branch_stock
  where product_id = v_prod and sucursal_id = v_suc;
  v_cur := coalesce(v_cur, 0);
  v_avg := coalesce(v_avg, 0);

  if v_kind = 'entrada' then
    if v_qty is null or v_qty <= 0 then
      raise exception 'BAD_QTY: entrada requiere quantity > 0'
        using errcode = 'check_violation';
    end if;
    v_ucost  := coalesce(v_ucost, v_avg);   -- sin costo → neutral al promedio
    v_signed := v_qty;
    -- Crea lote para que FIFO se reabastezca (lo que el insert directo no hacía).
    insert into lots (product_id, sucursal_id, lot_code, qty_received,
                      qty_remaining, cost, expiry_date)
    values (v_prod, v_suc,
            coalesce(v_lotc, 'M-' || to_char(now(), 'YYYYMMDDHH24MISS')),
            v_qty, v_qty, v_ucost, v_exp)
    returning id into v_lot;

  elsif v_kind = 'ajuste' then
    if v_target is null or v_target < 0 then
      raise exception 'BAD_TARGET: ajuste requiere target_qty >= 0'
        using errcode = 'check_violation';
    end if;
    if v_reason is null then
      raise exception 'REASON_REQUIRED: el ajuste exige motivo'
        using errcode = 'check_violation';
    end if;
    v_signed := v_target - v_cur;            -- delta con signo (sube o baja)
    if v_signed = 0 then
      return jsonb_build_object(
        'product_id', v_prod, 'kind', v_kind, 'applied_qty', 0,
        'new_stock', v_cur, 'avg_cost', v_avg, 'lot_id', null, 'noop', true);
    end if;
    -- Por defecto el ajuste no altera el promedio; si un reconteo al alza trae
    -- costo explícito (producto sin costo previo) se respeta.
    v_ucost := coalesce(v_ucost, v_avg);

  elsif v_kind in ('salida', 'merma') then
    if v_qty is null or v_qty <= 0 then
      raise exception 'BAD_QTY: % requiere quantity > 0', v_kind
        using errcode = 'check_violation';
    end if;
    if v_kind = 'merma' and v_reason is null then
      raise exception 'REASON_REQUIRED: la merma exige motivo'
        using errcode = 'check_violation';
    end if;
    v_signed := -v_qty;
    v_ucost  := coalesce(v_ucost, v_avg);

  else
    raise exception 'BAD_KIND: % no soportado', v_kind
      using errcode = 'check_violation';
  end if;

  -- El trigger apply_inventory_movement valida stock no-negativo y sincroniza
  -- branch_stock + costo promedio (solo recalcula promedio cuando quantity > 0).
  insert into inventory_movements (sucursal_id, product_id, lot_id, kind,
                                   quantity, unit_cost, ref_type, created_by)
  values (v_suc, v_prod, v_lot, v_kind, v_signed, coalesce(v_ucost, 0),
          coalesce(v_reason, v_kind), auth.uid());

  -- Para salidas físicas descuenta los lotes FIFO (después del guard de stock).
  if v_kind in ('salida', 'merma') then
    perform fifo_consume_lots(v_prod, v_suc, v_qty);
  end if;

  select stock, avg_cost into v_new, v_avg
  from branch_stock
  where product_id = v_prod and sucursal_id = v_suc;

  return jsonb_build_object(
    'product_id', v_prod, 'kind', v_kind, 'applied_qty', v_signed,
    'new_stock', v_new, 'avg_cost', v_avg, 'lot_id', v_lot);
end $$;
