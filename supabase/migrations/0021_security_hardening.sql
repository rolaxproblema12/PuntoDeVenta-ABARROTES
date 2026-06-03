-- 0021_security_hardening: cierra dos huecos de autorización encontrados en la
-- auditoría. Idempotente (create or replace). No recrea triggers ni tablas.

-- ── #1 set_tenant_status: exigir platform-admin ──────────────────────────────
-- Antes era `language sql security definer` SIN guard: cualquier usuario
-- autenticado podía invocar la RPC y suspender/reactivar cualquier tenant,
-- saltándose el RLS de `tenants` (que sí exige is_platform_admin) porque
-- SECURITY DEFINER lo bypassa. Ahora re-valida el rol dentro de la función.
create or replace function set_tenant_status(p_tenant uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'FORBIDDEN: solo el administrador de plataforma puede cambiar el estado de un tenant'
      using errcode = 'insufficient_privilege';
  end if;
  update tenants set status = p_status::tenant_status where id = p_tenant;
end $$;

-- ── #2 apply_credit_movement: el cliente debe ser de la misma sucursal ───────
-- El RLS de customer_credit_movements valida `sucursal_id`, pero no la relación
-- cliente↔sucursal. Sin esto, un usuario activo en la sucursal A podía insertar
-- un movimiento (sucursal_id=A) contra un customer_id de la sucursal B y alterar
-- su saldo. Se re-valida la pertenencia antes de tocar el saldo.
create or replace function apply_credit_movement() returns trigger
language plpgsql as $$
declare v_bal bigint;
begin
  if not exists (select 1 from customers
                 where id = new.customer_id and sucursal_id = new.sucursal_id) then
    raise exception 'CUSTOMER_NOT_IN_SUCURSAL: el cliente no pertenece a la sucursal del movimiento'
      using errcode = 'insufficient_privilege';
  end if;

  select current_balance into v_bal from customers
    where id = new.customer_id for update;
  v_bal := coalesce(v_bal,0) + case when new.kind = 'cargo'
             then new.amount else -new.amount end;
  update customers set current_balance = v_bal where id = new.customer_id;
  new.balance_after := v_bal;
  return new;
end $$;
