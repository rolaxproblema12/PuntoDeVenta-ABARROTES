-- 0029_import_export_safe: importación/exportación de base segura.
--   a) patch_product: UPDATE NO destructivo (merge por COALESCE) para no perder
--      datos al actualizar duplicados. A diferencia de upsert_product (0023, que
--      en UPDATE reemplaza TODO y borra códigos secundarios), aquí lo ausente se
--      conserva y nunca se borran códigos de barras.
--   b) set_stock_levels: ajuste de existencias en lote (kind='ajuste' = absoluto e
--      idempotente). Re-importar el mismo archivo no duplica stock.
--   c) Índices únicos para evitar categorías/proveedores duplicados.
-- NO se editan migraciones previas. Idempotente.

-- ── a) patch_product: merge no destructivo ──────────────────────────────────
create or replace function patch_product(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suc uuid := (p->>'sucursal_id')::uuid;
  v_id  uuid := nullif(p->>'id','')::uuid;
  v_bc  text := nullif(trim(p->>'barcode'),'');
  v_has_price boolean := (p ? 'price') and nullif(p->>'price','') is not null;
  v_has_cost  boolean := (p ? 'cost')  and nullif(p->>'cost','')  is not null;
  v_has_may   boolean := (p ? 'mayoreo') and nullif(p->>'mayoreo','') is not null;
  v_list  uuid;
  v_owner uuid;
begin
  if v_id is null then
    raise exception 'BAD_REQUEST: id requerido' using errcode = 'check_violation';
  end if;
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from products where id = v_id and sucursal_id = v_suc) then
    raise exception 'PRODUCT_NOT_IN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  -- Aislamiento: categoría/proveedor del payload deben ser de la sucursal.
  if nullif(p->>'category_id','') is not null
     and not exists (select 1 from categories
                     where id = (p->>'category_id')::uuid
                       and (sucursal_id = v_suc or sucursal_id is null)) then
    raise exception 'CATEGORY_NOT_IN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if nullif(p->>'default_supplier_id','') is not null
     and not exists (select 1 from suppliers
                     where id = (p->>'default_supplier_id')::uuid
                       and sucursal_id = v_suc) then
    raise exception 'SUPPLIER_NOT_IN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if v_has_price and (p->>'price')::bigint < 0 then
    raise exception 'BAD_MONEY: precio negativo' using errcode = 'check_violation';
  end if;
  if v_has_cost and (p->>'cost')::bigint < 0 then
    raise exception 'BAD_MONEY: costo negativo' using errcode = 'check_violation';
  end if;

  -- Merge: solo cambian las claves presentes; lo ausente conserva su valor.
  -- Para FKs nullables (category_id/brand_id/default_supplier_id/max_stock) se usa
  -- `p ? clave` para distinguir "ausente" (no tocar) de "null explícito" (limpiar).
  update products set
    name        = coalesce(nullif(trim(p->>'name'), ''), name),
    category_id = case when p ? 'category_id'
                         then nullif(p->>'category_id','')::uuid else category_id end,
    brand_id    = case when p ? 'brand_id'
                         then nullif(p->>'brand_id','')::uuid else brand_id end,
    base_unit   = coalesce(nullif(p->>'base_unit',''), base_unit),
    is_weighed     = coalesce((p->>'is_weighed')::boolean, is_weighed),
    age_restricted = coalesce((p->>'age_restricted')::boolean, age_restricted),
    tax_rate    = coalesce(nullif(p->>'tax_rate','')::numeric, tax_rate),
    default_supplier_id = case when p ? 'default_supplier_id'
                         then nullif(p->>'default_supplier_id','')::uuid
                         else default_supplier_id end,
    track_lots   = coalesce((p->>'track_lots')::boolean, track_lots),
    track_expiry = coalesce((p->>'track_expiry')::boolean, track_expiry),
    min_stock = coalesce(nullif(p->>'min_stock','')::numeric, min_stock),
    max_stock = case when p ? 'max_stock'
                       then nullif(p->>'max_stock','')::numeric else max_stock end,
    sat_code  = coalesce(nullif(trim(p->>'sat_code'),''), sat_code),
    sat_unit  = coalesce(nullif(trim(p->>'sat_unit'),''), sat_unit),
    active    = coalesce((p->>'active')::boolean, active)
  where id = v_id;

  -- Precio/costo menudeo: solo si vienen en el payload (no pisa con 0).
  if v_has_price or v_has_cost then
    select id into v_list from price_lists
      where sucursal_id = v_suc and type = 'menudeo' order by created_at limit 1;
    if v_list is null then
      insert into price_lists (sucursal_id, name, type)
      values (v_suc, 'Menudeo', 'menudeo') returning id into v_list;
    end if;
    if exists (select 1 from product_prices
               where product_id = v_id and price_list_id = v_list
                 and variant_id is null and min_qty = 1) then
      update product_prices set
        price = case when v_has_price then (p->>'price')::bigint else price end,
        cost  = case when v_has_cost  then (p->>'cost')::bigint  else cost  end
      where product_id = v_id and price_list_id = v_list
        and variant_id is null and min_qty = 1;
    else
      insert into product_prices (product_id, price_list_id, variant_id, price, cost, min_qty)
      values (v_id, v_list, null,
              coalesce((p->>'price')::bigint, 0),
              coalesce((p->>'cost')::bigint, 0), 1);
    end if;
  end if;

  -- Precio de mayoreo (segunda lista). Solo si viene 'mayoreo'.
  if v_has_may then
    select id into v_list from price_lists
      where sucursal_id = v_suc and type = 'mayoreo' order by created_at limit 1;
    if v_list is null then
      insert into price_lists (sucursal_id, name, type)
      values (v_suc, 'Mayoreo', 'mayoreo') returning id into v_list;
    end if;
    if exists (select 1 from product_prices
               where product_id = v_id and price_list_id = v_list
                 and variant_id is null and min_qty = 1) then
      update product_prices set price = (p->>'mayoreo')::bigint
        where product_id = v_id and price_list_id = v_list
          and variant_id is null and min_qty = 1;
    else
      insert into product_prices (product_id, price_list_id, variant_id, price, cost, min_qty)
      values (v_id, v_list, null, (p->>'mayoreo')::bigint, 0, 1);
    end if;
  end if;

  -- Código de barras: AGREGA sin borrar los demás (a diferencia de upsert_product).
  if v_bc is not null then
    select product_id into v_owner from product_barcodes
      where sucursal_id = v_suc and barcode = v_bc;
    if v_owner is not null and v_owner <> v_id then
      raise exception 'BARCODE_TAKEN: el código % ya está en uso en esta sucursal', v_bc
        using errcode = 'unique_violation';
    end if;
    if v_owner is null then
      insert into product_barcodes (product_id, sucursal_id, barcode)
      values (v_id, v_suc, v_bc);
    end if;
  end if;

  return jsonb_build_object('product_id', v_id);
end $$;

-- ── b) set_stock_levels: ajuste de existencias en lote (idempotente) ────────
-- Recibe { sucursal_id, reason, items:[{product_id, target_qty}] }. Cada item es
-- un ajuste ABSOLUTO a target_qty (reusa record_stock_movement kind='ajuste'):
-- re-importar el mismo archivo da delta 0 → noop, sin duplicar entradas. Un item
-- que falla no aborta el lote (se acumula en failed[]).
create or replace function set_stock_levels(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suc    uuid := (p_payload->>'sucursal_id')::uuid;
  v_reason text := coalesce(nullif(trim(p_payload->>'reason'), ''), 'Importación de existencias');
  v_item   jsonb;
  v_applied int := 0;
  v_noop    int := 0;
  v_failed  jsonb := '[]'::jsonb;
  v_res     jsonb;
begin
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  for v_item in
    select value from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  loop
    begin
      v_res := record_stock_movement(jsonb_build_object(
        'sucursal_id', v_suc,
        'product_id',  v_item->>'product_id',
        'kind',        'ajuste',
        'target_qty',  (v_item->>'target_qty')::numeric,
        'unit_cost',   nullif(v_item->>'unit_cost', ''),  -- fija costo promedio al subir
        'reason',      v_reason));
      if coalesce((v_res->>'noop')::boolean, false)
        then v_noop := v_noop + 1;
        else v_applied := v_applied + 1;
      end if;
    exception when others then
      v_failed := v_failed || jsonb_build_object(
        'product_id', v_item->>'product_id', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('applied', v_applied, 'noop', v_noop, 'failed', v_failed);
end $$;

-- ── c) Unicidad para evitar duplicados (no existían). Defensivo: solo crea el
--        índice si no hay duplicados ya presentes, para no abortar la migración.
do $$ begin
  if not exists (
    select 1 from categories where sucursal_id is not null
    group by sucursal_id, lower(name) having count(*) > 1
  ) then
    create unique index if not exists uq_categories_suc_name
      on categories (sucursal_id, lower(name)) where sucursal_id is not null;
  else
    raise notice 'categories: duplicados por (sucursal_id, lower(name)); se omite índice único';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from suppliers group by sucursal_id, lower(name) having count(*) > 1
  ) then
    create unique index if not exists uq_suppliers_suc_name
      on suppliers (sucursal_id, lower(name));
  else
    raise notice 'suppliers: duplicados por (sucursal_id, lower(name)); se omite índice único';
  end if;
end $$;
