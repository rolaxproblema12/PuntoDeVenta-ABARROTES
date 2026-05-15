-- 0009_settings_sync: settings por sucursal + cola de sincronización offline.

create table if not exists settings (
  scope       text not null default 'global',  -- 'global' | 'sucursal'
  sucursal_id uuid references sucursales(id) on delete cascade,
  key         text not null,
  value       jsonb not null default '{}'::jsonb,
  primary key (scope, sucursal_id, key)
);
alter table settings enable row level security;
do $$ begin
  create policy settings_read on settings for select
    using (scope = 'global'
           or (sucursal_id is not null and is_active_user_in_sucursal(sucursal_id)));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy settings_admin on settings for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- Cola de operaciones offline (respaldo server-side de idempotencia).
-- client_op_id único → un replay duplicado nunca duplica la venta.
create table if not exists sync_queue (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  client_op_id uuid not null unique,
  op_type     text not null check (op_type in
                ('sale.create','sale.cancel','return.create')),
  payload     jsonb not null,
  status      text not null default 'pending'
                check (status in ('pending','applied','conflict','failed')),
  result      jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  applied_at  timestamptz
);
call apply_sucursal_rls('sync_queue');

-- Esqueleto módulo 9 (IA) — sin productor en v1, feature-flag.
create table if not exists ai_signals (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  kind        text not null check (kind in
                ('high_rotation','shortage_pred','price_rec')),
  product_id  uuid references products(id) on delete cascade,
  payload     jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);
call apply_sucursal_rls('ai_signals');
