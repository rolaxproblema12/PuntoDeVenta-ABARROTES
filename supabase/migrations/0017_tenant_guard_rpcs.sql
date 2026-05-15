-- 0017_tenant_guard: bloquea ventas si el tenant está suspendido/cancelado.
-- Se implementa como trigger BEFORE INSERT en `sales` (no se reescribe el RPC
-- grande register_sale → cero riesgo de drift; cubre cualquier vía de venta).
-- El aislamiento entre tenants ya lo garantiza is_active_user_in_sucursal()
-- (reescrito tenant-aware en 0014).

create or replace function assert_sucursal_tenant_operational(p_sucursal uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.status in ('trial','active','past_due')
       from sucursales s
       join tenants t on t.id = s.tenant_id
      where s.id = p_sucursal),
    true);  -- sucursal sin tenant (datos legacy/seed) → no bloquear
$$;

create or replace function sales_tenant_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not assert_sucursal_tenant_operational(new.sucursal_id) then
    raise exception 'TENANT_SUSPENDED: suscripción inactiva'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_sales_tenant_guard on sales;
create trigger trg_sales_tenant_guard before insert on sales
  for each row execute function sales_tenant_guard();
