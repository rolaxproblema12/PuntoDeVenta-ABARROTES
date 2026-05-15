-- 0014_tenancy: capa SaaS multi-tenant (pooled: BD compartida + tenant_id + RLS).
-- NO se editan migraciones 0001–0013. Idempotente.
--
-- Diseño de aislamiento: el `tenant_id` ancla en `sucursales` y `profiles`.
-- Toda tabla transaccional ya enruta su RLS por `is_active_user_in_sucursal()`
-- (directa o vía padre). Se reescribe ese helper para exigir que la sucursal
-- pertenezca al tenant del usuario → todas las tablas hijas quedan aisladas
-- por tenant con un solo punto de control (robusto y sin backfill de 30 tablas).

do $$ begin
  create type tenant_status as enum
    ('trial','active','past_due','suspended','canceled');
exception when duplicate_object then null; end $$;

-- ── Planes ───────────────────────────────────────────────────────────────────
create table if not exists plans (
  code           text primary key,
  name           text not null,
  price_cents    bigint not null default 0,
  currency       text not null default 'MXN',
  max_sucursales int not null default 1,
  max_users      int not null default 2,
  features       jsonb not null default '{}'::jsonb,
  stripe_price_id text
);
insert into plans (code, name, price_cents, max_sucursales, max_users) values
  ('basico','Básico',  49900, 1, 2),
  ('pro',   'Pro',    99900, 3, 10),
  ('negocio','Negocio',199900, 50, 200)
on conflict (code) do nothing;

-- ── Tenants ──────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  status        tenant_status not null default 'trial',
  plan_code     text not null default 'basico' references plans(code),
  trial_ends_at timestamptz,
  owner_user_id uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create table if not exists platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  tenant_id              uuid primary key references tenants(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan_code              text not null default 'basico' references plans(code),
  status                 text not null default 'trialing',
  current_period_end     timestamptz,
  trial_ends_at          timestamptz,
  updated_at             timestamptz not null default now()
);

-- Idempotencia de webhooks de Stripe.
create table if not exists billing_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references tenants(id) on delete set null,
  stripe_event_id text not null unique,
  type            text not null,
  payload         jsonb not null,
  processed_at    timestamptz not null default now()
);

-- ── Anclas de tenant ─────────────────────────────────────────────────────────
alter table sucursales add column if not exists tenant_id uuid references tenants(id);
alter table profiles   add column if not exists tenant_id uuid references tenants(id);
create index if not exists idx_sucursales_tenant on sucursales (tenant_id);
create index if not exists idx_profiles_tenant   on profiles (tenant_id);

-- ── Helpers de tenant ────────────────────────────────────────────────────────
create or replace function current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from profiles where id = auth.uid();
$$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- El tenant del usuario está operativo (no suspendido/cancelado).
create or replace function tenant_is_operational() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select status in ('trial','active','past_due')
       from tenants where id = current_tenant_id()),
    false);
$$;

-- Reescritura tenant-aware del helper central. Mantiene la lógica de sucursal
-- pero exige que la sucursal pertenezca al tenant del usuario. Platform-admin
-- ve todo (las escrituras destructivas se bloquean en la capa API/guards).
create or replace function is_active_user_in_sucursal(p_sucursal uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (
    select 1
    from profiles p
    join sucursales s on s.id = p_sucursal
    where p.id = auth.uid()
      and p.active
      and s.tenant_id is not distinct from p.tenant_id
      and (
        p.role = 'administrador'
        or exists (
          select 1 from user_sucursales us
          where us.user_id = p.id and us.sucursal_id = p_sucursal
        )
      )
  );
$$;

-- ── RLS de las tablas SaaS ───────────────────────────────────────────────────
alter table tenants         enable row level security;
alter table subscriptions   enable row level security;
alter table plans           enable row level security;
alter table platform_admins enable row level security;
alter table billing_events  enable row level security;

do $$ begin
  create policy tenants_read on tenants for select
    using (id = current_tenant_id() or is_platform_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tenants_admin on tenants for all
    using (is_platform_admin()) with check (is_platform_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy subscriptions_read on subscriptions for select
    using (tenant_id = current_tenant_id() or is_platform_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy subscriptions_admin on subscriptions for all
    using (is_platform_admin()) with check (is_platform_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy plans_read on plans for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy plans_admin on plans for all
    using (is_platform_admin()) with check (is_platform_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy platform_admins_self on platform_admins for select
    using (user_id = auth.uid() or is_platform_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy billing_events_admin on billing_events for all
    using (is_platform_admin()) with check (is_platform_admin());
exception when duplicate_object then null; end $$;
