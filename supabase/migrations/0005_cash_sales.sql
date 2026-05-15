-- 0005_cash_sales: folios, cajas, sesiones, ventas, items, pagos, devoluciones.
-- NÚCLEO de integridad del POS. Montos en centavos (bigint).

-- ── Folios consecutivos por sucursal ─────────────────────────────────────────
create table if not exists sucursal_counters (
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  kind        text not null,
  value       bigint not null default 0,
  primary key (sucursal_id, kind)
);
alter table sucursal_counters enable row level security;
do $$ begin
  create policy sucursal_counters_rls on sucursal_counters for all
    using (is_active_user_in_sucursal(sucursal_id))
    with check (is_active_user_in_sucursal(sucursal_id));
exception when duplicate_object then null; end $$;

create or replace function next_folio(p_sucursal uuid, p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_val  bigint;
begin
  insert into sucursal_counters (sucursal_id, kind, value)
  values (p_sucursal, p_kind, 0)
  on conflict (sucursal_id, kind) do nothing;

  update sucursal_counters set value = value + 1
  where sucursal_id = p_sucursal and kind = p_kind
  returning value into v_val;

  select code into v_code from sucursales where id = p_sucursal;
  return coalesce(v_code,'XX') || '-' || lpad(v_val::text, 4, '0');
end $$;

-- ── Cajas ────────────────────────────────────────────────────────────────────
create table if not exists registers (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  name        text not null,
  active      boolean not null default true
);
call apply_sucursal_rls('registers');

-- ── Sesiones de caja (una abierta por caja) ──────────────────────────────────
create table if not exists cash_sessions (
  id             uuid primary key default gen_random_uuid(),
  sucursal_id    uuid not null references sucursales(id) on delete cascade,
  register_id    uuid not null references registers(id) on delete cascade,
  status         text not null default 'open' check (status in ('open','closed')),
  opening_amount bigint not null default 0,
  opened_by      uuid not null references profiles(id),
  opened_at      timestamptz not null default now(),
  expected_cash  bigint,
  counted_cash   bigint,
  difference     bigint,
  closing_notes  text,
  created_at     timestamptz not null default now(),
  created_by     uuid references profiles(id),
  updated_at     timestamptz
);
call apply_sucursal_rls('cash_sessions');
create unique index if not exists uq_cash_session_open
  on cash_sessions (register_id) where status = 'open';

-- ── Ventas ───────────────────────────────────────────────────────────────────
create table if not exists sales (
  id               uuid primary key default gen_random_uuid(),
  sucursal_id      uuid not null references sucursales(id) on delete cascade,
  folio            text not null,
  register_id      uuid not null references registers(id),
  cash_session_id  uuid not null references cash_sessions(id),
  customer_id      uuid,
  subtotal         bigint not null default 0,
  tax_total        bigint not null default 0,
  discount_total   bigint not null default 0,
  tip              bigint not null default 0,
  total            bigint not null default 0,
  payment_method   text not null
                     check (payment_method in
                       ('efectivo','tarjeta','transferencia','mixto','credito')),
  status           text not null default 'completada'
                     check (status in ('completada','cancelada','devuelta')),
  cancelled_at     timestamptz,
  cancelled_by     uuid references profiles(id),
  cancelled_reason text,
  created_at       timestamptz not null default now(),
  created_by       uuid references profiles(id),
  updated_at       timestamptz,
  unique (sucursal_id, folio)
);
call apply_sucursal_rls('sales');
create index if not exists idx_sales_session on sales (cash_session_id);
create index if not exists idx_sales_created on sales (sucursal_id, created_at);

create table if not exists sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  product_id  uuid references products(id),
  variant_id  uuid references product_variants(id),
  lot_id      uuid references lots(id),
  kind        text not null default 'producto'
                check (kind in ('producto','combo','abono_credito')),
  description text not null,
  quantity    numeric(14,3) not null,
  unit        text not null default 'pieza',
  unit_price  bigint not null default 0,
  unit_cost   bigint not null default 0,
  tax_rate    numeric(4,3) not null default 0,
  discount    bigint not null default 0,
  line_total  bigint not null default 0
);
call apply_sucursal_rls('sale_items');

create table if not exists sale_payments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  method      text not null
                check (method in
                  ('efectivo','tarjeta','transferencia','mixto','credito')),
  amount      bigint not null default 0,
  reference   text
);
call apply_sucursal_rls('sale_payments');

-- ── Ventas suspendidas (suspender/recuperar) ─────────────────────────────────
create table if not exists suspended_sales (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  register_id uuid not null references registers(id),
  cart        jsonb not null,
  customer_id uuid,
  label       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id)
);
call apply_sucursal_rls('suspended_sales');

-- ── Devoluciones ─────────────────────────────────────────────────────────────
create table if not exists returns (
  id             uuid primary key default gen_random_uuid(),
  sucursal_id    uuid not null references sucursales(id) on delete cascade,
  sale_id        uuid not null references sales(id),
  reason         text not null,
  refund_method  text not null,
  total          bigint not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid references profiles(id)
);
call apply_sucursal_rls('returns');

create table if not exists return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references returns(id) on delete cascade,
  sale_item_id uuid not null references sale_items(id),
  quantity     numeric(14,3) not null check (quantity > 0),
  refund_amount bigint not null default 0
);
alter table return_items enable row level security;
do $$ begin
  create policy return_items_rls on return_items for all
    using (exists (select 1 from returns r where r.id = return_id
            and is_active_user_in_sucursal(r.sucursal_id)))
    with check (exists (select 1 from returns r where r.id = return_id
            and is_active_user_in_sucursal(r.sucursal_id)));
exception when duplicate_object then null; end $$;
