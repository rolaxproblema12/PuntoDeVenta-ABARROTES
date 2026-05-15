-- 0002_catalog: categorías, marcas, proveedores, productos, variantes, códigos.

-- Helper: aplica RLS estándar por sucursal a una tabla con columna sucursal_id.
-- Lectura/escritura permitida si el usuario está activo en esa sucursal.
create or replace procedure apply_sucursal_rls(p_table text)
language plpgsql as $$
begin
  execute format('alter table %I enable row level security', p_table);
  begin
    execute format(
      'create policy %I on %I for all using (is_active_user_in_sucursal(sucursal_id)) with check (is_active_user_in_sucursal(sucursal_id))',
      p_table || '_sucursal_rls', p_table);
  exception when duplicate_object then null; end;
end $$;

-- ── Categorías (jerárquicas) ─────────────────────────────────────────────────
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid references sucursales(id) on delete cascade,
  parent_id   uuid references categories(id) on delete set null,
  name        text not null,
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);
alter table categories enable row level security;
do $$ begin
  create policy categories_rls on categories for all
    using (sucursal_id is null or is_active_user_in_sucursal(sucursal_id))
    with check (sucursal_id is null or is_active_user_in_sucursal(sucursal_id));
exception when duplicate_object then null; end $$;

-- ── Marcas (globales) ────────────────────────────────────────────────────────
create table if not exists brands (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);
alter table brands enable row level security;
do $$ begin
  create policy brands_read on brands for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy brands_write on brands for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── Proveedores ──────────────────────────────────────────────────────────────
create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  name        text not null,
  rfc         text,
  contact     text,
  terms_days  int  not null default 0,
  frequent    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id),
  updated_at  timestamptz
);
call apply_sucursal_rls('suppliers');

-- ── Productos ────────────────────────────────────────────────────────────────
create table if not exists products (
  id                  uuid primary key default gen_random_uuid(),
  sucursal_id         uuid not null references sucursales(id) on delete cascade,
  sku                 text not null,
  name                text not null,
  category_id         uuid references categories(id) on delete set null,
  brand_id            uuid references brands(id) on delete set null,
  base_unit           text not null default 'pieza'
                        check (base_unit in ('pieza','caja','paquete','peso')),
  is_weighed          boolean not null default false,
  age_restricted      boolean not null default false,
  tax_rate            numeric(4,3) not null default 0.160,
  sat_code            text,
  sat_unit            text,
  default_supplier_id uuid references suppliers(id) on delete set null,
  track_lots          boolean not null default false,
  track_expiry        boolean not null default false,
  min_stock           numeric(14,3) not null default 0,
  max_stock           numeric(14,3),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles(id),
  updated_at          timestamptz,
  unique (sucursal_id, sku)
);
drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();
call apply_sucursal_rls('products');

-- ── Códigos de barras (1 producto → N códigos / packs) ───────────────────────
create table if not exists product_barcodes (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  barcode    text not null unique,
  pack_qty   numeric(14,3) not null default 1,
  unit_label text not null default 'pieza'
);
alter table product_barcodes enable row level security;
do $$ begin
  create policy product_barcodes_rls on product_barcodes for all
    using (exists (select 1 from products p
            where p.id = product_id and is_active_user_in_sucursal(p.sucursal_id)))
    with check (exists (select 1 from products p
            where p.id = product_id and is_active_user_in_sucursal(p.sucursal_id)));
exception when duplicate_object then null; end $$;

-- ── Variantes ────────────────────────────────────────────────────────────────
create table if not exists product_variants (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name       text not null,
  sku        text,
  barcode    text,
  attributes jsonb not null default '{}'::jsonb
);
alter table product_variants enable row level security;
do $$ begin
  create policy product_variants_rls on product_variants for all
    using (exists (select 1 from products p
            where p.id = product_id and is_active_user_in_sucursal(p.sucursal_id)))
    with check (exists (select 1 from products p
            where p.id = product_id and is_active_user_in_sucursal(p.sucursal_id)));
exception when duplicate_object then null; end $$;

-- ── Conversión de unidades (caja→pieza, etc.) ────────────────────────────────
create table if not exists unit_conversions (
  product_id uuid not null references products(id) on delete cascade,
  from_unit  text not null,
  to_unit    text not null,
  factor     numeric(14,4) not null,
  primary key (product_id, from_unit, to_unit)
);
alter table unit_conversions enable row level security;
do $$ begin
  create policy unit_conversions_rls on unit_conversions for all
    using (exists (select 1 from products p
            where p.id = product_id and is_active_user_in_sucursal(p.sucursal_id)))
    with check (exists (select 1 from products p
            where p.id = product_id and is_active_user_in_sucursal(p.sucursal_id)));
exception when duplicate_object then null; end $$;
