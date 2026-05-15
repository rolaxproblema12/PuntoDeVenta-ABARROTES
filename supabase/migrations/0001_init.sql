-- 0001_init: extensiones, identidad, sucursales, roles, helpers RLS.
-- Idempotente: re-ejecutable sin error.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ── Enums de dominio ─────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('cajero','encargado','supervisor','administrador');
exception when duplicate_object then null; end $$;

-- ── updated_at automático ────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── Sucursales ───────────────────────────────────────────────────────────────
create table if not exists sucursales (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  address     text,
  currency    text not null default 'MXN',
  timezone    text not null default 'America/Mexico_City',
  active      boolean not null default true,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ── Perfiles (1:1 con auth.users) ────────────────────────────────────────────
create table if not exists profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  full_name           text not null default '',
  email               text not null,
  role                user_role not null default 'cajero',
  active              boolean not null default false,
  pin_hash            text,
  default_sucursal_id uuid references sucursales(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);
drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- ── Asignación usuario ↔ sucursal (N:N) ──────────────────────────────────────
create table if not exists user_sucursales (
  user_id      uuid not null references profiles(id) on delete cascade,
  sucursal_id  uuid not null references sucursales(id) on delete cascade,
  role_override user_role,
  primary key (user_id, sucursal_id)
);

-- ── Permisos por rol (acción → permitido) ────────────────────────────────────
create table if not exists permissions (
  role        user_role not null,
  action_key  text not null,
  allowed     boolean not null default true,
  primary key (role, action_key)
);

-- ── Códigos de acceso (alta de usuarios) ─────────────────────────────────────
create table if not exists access_codes (
  code        text primary key,
  role        user_role not null default 'cajero',
  sucursal_id uuid references sucursales(id),
  used_by     uuid references profiles(id),
  used_at     timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ── Helpers de seguridad (SECURITY DEFINER, usados por políticas RLS) ─────────
create or replace function current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'administrador' from profiles where id = auth.uid()), false);
$$;

create or replace function is_active_user_in_sucursal(p_sucursal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.active
      and (
        p.role = 'administrador'
        or exists (
          select 1 from user_sucursales us
          where us.user_id = p.id and us.sucursal_id = p_sucursal
        )
      )
  );
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table sucursales      enable row level security;
alter table profiles        enable row level security;
alter table user_sucursales enable row level security;
alter table permissions     enable row level security;
alter table access_codes    enable row level security;

do $$ begin
  create policy sucursales_read on sucursales for select
    using (is_admin() or is_active_user_in_sucursal(id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy sucursales_admin on sucursales for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy profiles_self_read on profiles for select
    using (id = auth.uid() or is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy profiles_admin_write on profiles for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy user_sucursales_read on user_sucursales for select
    using (user_id = auth.uid() or is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy user_sucursales_admin on user_sucursales for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy permissions_read on permissions for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy permissions_admin on permissions for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy access_codes_admin on access_codes for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── Alta automática de profile al crear auth.user ────────────────────────────
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
