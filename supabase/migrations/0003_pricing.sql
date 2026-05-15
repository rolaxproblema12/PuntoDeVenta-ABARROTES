-- 0003_pricing: listas de precios, precios por producto, promociones, combos.
-- Montos en centavos (bigint).

create table if not exists price_lists (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  name        text not null,
  type        text not null default 'menudeo'
                check (type in ('menudeo','mayoreo','especial')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
call apply_sucursal_rls('price_lists');

create table if not exists product_prices (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  price_list_id uuid not null references price_lists(id) on delete cascade,
  variant_id    uuid references product_variants(id) on delete cascade,
  price         bigint not null default 0,   -- centavos
  cost          bigint not null default 0,   -- centavos
  min_qty       numeric(14,3) not null default 1,
  unique (product_id, price_list_id, variant_id, min_qty)
);
alter table product_prices enable row level security;
do $$ begin
  create policy product_prices_rls on product_prices for all
    using (exists (select 1 from products p
            where p.id = product_id and is_active_user_in_sucursal(p.sucursal_id)))
    with check (exists (select 1 from products p
            where p.id = product_id and is_active_user_in_sucursal(p.sucursal_id)));
exception when duplicate_object then null; end $$;

create table if not exists promotions (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  name        text not null,
  type        text not null
                check (type in ('pct','monto','2x1','nxm','precio_fijo')),
  value       numeric(14,3) not null default 0,
  scope       text not null default 'product'
                check (scope in ('product','category','all')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  active      boolean not null default true,
  schedule    jsonb,
  created_at  timestamptz not null default now()
);
call apply_sucursal_rls('promotions');

create table if not exists promotion_targets (
  promotion_id uuid not null references promotions(id) on delete cascade,
  product_id   uuid references products(id) on delete cascade,
  category_id  uuid references categories(id) on delete cascade,
  primary key (promotion_id, product_id, category_id)
);
alter table promotion_targets enable row level security;
do $$ begin
  create policy promotion_targets_rls on promotion_targets for all
    using (exists (select 1 from promotions pr
            where pr.id = promotion_id and is_active_user_in_sucursal(pr.sucursal_id)))
    with check (exists (select 1 from promotions pr
            where pr.id = promotion_id and is_active_user_in_sucursal(pr.sucursal_id)));
exception when duplicate_object then null; end $$;

-- ── Combos / productos compuestos ────────────────────────────────────────────
create table if not exists combos (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  active      boolean not null default true
);
call apply_sucursal_rls('combos');

create table if not exists combo_items (
  combo_id     uuid not null references combos(id) on delete cascade,
  component_id uuid not null references products(id) on delete cascade,
  quantity     numeric(14,3) not null default 1,
  primary key (combo_id, component_id)
);
alter table combo_items enable row level security;
do $$ begin
  create policy combo_items_rls on combo_items for all
    using (exists (select 1 from combos c
            where c.id = combo_id and is_active_user_in_sucursal(c.sucursal_id)))
    with check (exists (select 1 from combos c
            where c.id = combo_id and is_active_user_in_sucursal(c.sucursal_id)));
exception when duplicate_object then null; end $$;
