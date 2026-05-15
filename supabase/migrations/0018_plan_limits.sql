-- 0018_plan_limits: aplica límites del plan server-side (no solo en UI).
-- Triggers BEFORE INSERT que validan max_sucursales / max_users del plan.

create or replace function enforce_sucursal_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is not null then
    perform assert_plan_limits(new.tenant_id, 'sucursal');
  end if;
  return new;
end $$;

drop trigger if exists trg_sucursal_limit on sucursales;
create trigger trg_sucursal_limit before insert on sucursales
  for each row execute function enforce_sucursal_limit();

create or replace function enforce_user_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Solo cuenta al asignar tenant (alta real de usuario en el tenant),
  -- no en la creación inicial vacía del trigger handle_new_user.
  if new.tenant_id is not null
     and (tg_op = 'INSERT' or old.tenant_id is distinct from new.tenant_id)
  then
    perform assert_plan_limits(new.tenant_id, 'user');
  end if;
  return new;
end $$;

drop trigger if exists trg_user_limit on profiles;
create trigger trg_user_limit before insert or update on profiles
  for each row execute function enforce_user_limit();
