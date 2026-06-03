-- 0023_catalog_rpcs: alta/edición ATÓMICA de productos (products + price +
-- barcode + stock inicial) en UNA función, y código de barras único POR
-- SUCURSAL (no global). NO se editan migraciones previas. Idempotente.

-- ── a) Código de barras único por sucursal (antes era unique global → bug
--        multi-tenant: dos negocios no podían usar el mismo código). ──────────
alter table product_barcodes
  add column if not exists sucursal_id uuid references sucursales(id) on delete cascade;

update product_barcodes pb
  set sucursal_id = p.sucursal_id
  from products p
  where p.id = pb.product_id and pb.sucursal_id is null;

alter table product_barcodes drop constraint if exists product_barcodes_barcode_key;
create unique index if not exists uq_barcode_sucursal
  on product_barcodes (sucursal_id, barcode);

do $$ begin
  if not exists (select 1 from product_barcodes where sucursal_id is null) then
    alter table product_barcodes alter column sucursal_id set not null;
  else
    raise notice 'product_barcodes.sucursal_id tiene NULLs: se omite SET NOT NULL';
  end if;
end $$;

-- ── b) upsert_product: producto + precio (menudeo) + código + stock inicial,
--        todo en UNA transacción (patrón de record_stock_movement, 0019). ─────
create or replace function upsert_product(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_suc   uuid    := (p->>'sucursal_id')::uuid;
  v_id    uuid    := nullif(p->>'id','')::uuid;
  v_isnew boolean := (nullif(p->>'id','')::uuid) is null;
  v_sku   text    := nullif(trim(p->>'sku'),'');
  v_price bigint  := coalesce(nullif(p->>'price','')::bigint, 0);
  v_cost  bigint  := coalesce(nullif(p->>'cost','')::bigint, 0);
  v_bc    text    := nullif(trim(p->>'barcode'),'');
  v_init  numeric := coalesce(nullif(p->>'initial_stock','')::numeric, 0);
  v_satc  text    := nullif(trim(p->>'sat_code'),'');
  v_satu  text    := nullif(trim(p->>'sat_unit'),'');
  v_list  uuid;
  v_owner uuid;
begin
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if nullif(trim(p->>'name'),'') is null then
    raise exception 'BAD_REQUEST: name requerido' using errcode = 'check_violation';
  end if;
  if v_price < 0 or v_cost < 0 then
    raise exception 'BAD_MONEY: precio/costo no pueden ser negativos'
      using errcode = 'check_violation';
  end if;
  -- Aislamiento (SECURITY DEFINER salta RLS): categoría y proveedor deben ser de
  -- la sucursal del usuario, para que un payload no enganche datos de otro negocio.
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
  if v_sku is null then
    v_sku := 'SKU-' || to_char(now(),'YYYYMMDDHH24MISS')
             || '-' || substr(gen_random_uuid()::text, 1, 4);
  end if;

  -- 1. Producto: insert (alta) o update (edición, validando que sea de la sucursal).
  if v_isnew then
    insert into products (sucursal_id, sku, name, category_id, brand_id, base_unit,
      is_weighed, age_restricted, tax_rate, default_supplier_id, track_lots,
      track_expiry, min_stock, max_stock, sat_code, sat_unit, active, created_by)
    values (v_suc, v_sku, trim(p->>'name'),
      nullif(p->>'category_id','')::uuid, nullif(p->>'brand_id','')::uuid,
      coalesce(nullif(p->>'base_unit',''), 'pieza'),
      coalesce((p->>'is_weighed')::boolean, false),
      coalesce((p->>'age_restricted')::boolean, false),
      coalesce(nullif(p->>'tax_rate','')::numeric, 0.16),
      nullif(p->>'default_supplier_id','')::uuid,
      coalesce((p->>'track_lots')::boolean, false),
      coalesce((p->>'track_expiry')::boolean, false),
      coalesce(nullif(p->>'min_stock','')::numeric, 0),
      nullif(p->>'max_stock','')::numeric,
      v_satc, v_satu,
      coalesce((p->>'active')::boolean, true),
      auth.uid())
    returning id into v_id;
  else
    if not exists (select 1 from products where id = v_id and sucursal_id = v_suc) then
      raise exception 'PRODUCT_NOT_IN_SUCURSAL' using errcode = 'insufficient_privilege';
    end if;
    update products set
      sku = v_sku, name = trim(p->>'name'),
      category_id = nullif(p->>'category_id','')::uuid,
      brand_id = nullif(p->>'brand_id','')::uuid,
      base_unit = coalesce(nullif(p->>'base_unit',''), 'pieza'),
      is_weighed = coalesce((p->>'is_weighed')::boolean, false),
      age_restricted = coalesce((p->>'age_restricted')::boolean, false),
      tax_rate = coalesce(nullif(p->>'tax_rate','')::numeric, 0.16),
      default_supplier_id = nullif(p->>'default_supplier_id','')::uuid,
      track_lots = coalesce((p->>'track_lots')::boolean, false),
      track_expiry = coalesce((p->>'track_expiry')::boolean, false),
      min_stock = coalesce(nullif(p->>'min_stock','')::numeric, 0),
      max_stock = nullif(p->>'max_stock','')::numeric,
      sat_code = v_satc, sat_unit = v_satu,
      active = coalesce((p->>'active')::boolean, true)
    where id = v_id;
  end if;

  -- 2. Lista de precios 'menudeo' (find-or-create) + precio/costo en centavos.
  select id into v_list from price_lists
    where sucursal_id = v_suc and type = 'menudeo'
    order by created_at limit 1;
  if v_list is null then
    insert into price_lists (sucursal_id, name, type)
    values (v_suc, 'Menudeo', 'menudeo') returning id into v_list;
  end if;
  if exists (select 1 from product_prices
             where product_id = v_id and price_list_id = v_list
               and variant_id is null and min_qty = 1) then
    update product_prices set price = v_price, cost = v_cost
      where product_id = v_id and price_list_id = v_list
        and variant_id is null and min_qty = 1;
  else
    insert into product_prices (product_id, price_list_id, variant_id, price, cost, min_qty)
    values (v_id, v_list, null, v_price, v_cost, 1);
  end if;

  -- 3. Código de barras (único por sucursal). Si ya es de OTRO producto → error.
  if v_bc is not null then
    -- Reemplaza el código del producto (evita códigos huérfanos al editar).
    delete from product_barcodes
      where product_id = v_id and sucursal_id = v_suc and barcode <> v_bc;
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

  -- 4. Stock inicial (solo en alta) como entrada auditada (lote + movimiento +
  --    branch_stock), reusando la RPC atómica de inventario.
  if v_isnew and v_init > 0 then
    perform record_stock_movement(jsonb_build_object(
      'sucursal_id', v_suc, 'product_id', v_id, 'kind', 'entrada',
      'quantity', v_init, 'unit_cost', v_cost));
  end if;

  return jsonb_build_object('product_id', v_id, 'sku', v_sku);
end $$;
