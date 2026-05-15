-- 0008_security_audit: bitácora de actividad + helper de verificación de PIN.

create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid references sucursales(id) on delete set null,
  user_id     uuid references profiles(id),
  action_key  text not null,
  entity      text,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
alter table activity_log enable row level security;
do $$ begin
  create policy activity_log_read on activity_log for select
    using (is_admin()
           or (sucursal_id is not null and is_active_user_in_sucursal(sucursal_id)));
exception when duplicate_object then null; end $$;
do $$ begin
  -- Inserción permitida a cualquier usuario activo (la API la usa para auditar).
  create policy activity_log_insert on activity_log for insert
    with check (auth.uid() is not null);
exception when duplicate_object then null; end $$;
create index if not exists idx_activity_log_time
  on activity_log (sucursal_id, created_at desc);

-- Verifica el PIN del usuario actual (bcrypt vía pgcrypto.crypt).
create or replace function verify_pin(p_pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select pin_hash = crypt(p_pin, pin_hash)
       from profiles where id = auth.uid() and pin_hash is not null),
    false);
$$;

-- Establece/actualiza el PIN del usuario actual (hash bcrypt).
create or replace function set_pin(p_pin text) returns void
language sql security definer set search_path = public, extensions as $$
  update profiles set pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = auth.uid();
$$;
