-- 0015_provisioning: alta atómica de un tenant + límites de plan.

-- Genera un código de sucursal corto único global (prefijo de folios).
create or replace function gen_sucursal_code() returns text
language plpgsql as $$
declare c text;
begin
  loop
    c := upper(left(replace(gen_random_uuid()::text,'-',''), 4));
    exit when not exists (select 1 from sucursales where code = c);
  end loop;
  return c;
end $$;

-- Provisiona TODO el sistema de un cliente en una sola transacción.
-- p: { owner_user_id, business_name, owner_name, plan_code }
create or replace function provision_tenant(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner   uuid := (p->>'owner_user_id')::uuid;
  v_name    text := p->>'business_name';
  v_oname   text := coalesce(p->>'owner_name','');
  v_plan    text := coalesce(p->>'plan_code','basico');
  v_trial   int  := 14;
  v_tenant  uuid;
  v_slug    text;
  v_suc     uuid;
begin
  if v_owner is null or v_name is null then
    raise exception 'INVALID_SIGNUP' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from plans where code = v_plan) then
    raise exception 'INVALID_PLAN' using errcode = 'check_violation';
  end if;

  v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || left(replace(gen_random_uuid()::text,'-',''), 6);

  insert into tenants (name, slug, status, plan_code, trial_ends_at,
                       owner_user_id)
  values (v_name, v_slug, 'trial', v_plan,
          now() + (v_trial || ' days')::interval, v_owner)
  returning id into v_tenant;

  -- El trigger handle_new_user ya creó el profile; lo promovemos a dueño.
  insert into profiles (id, email, full_name, role, active, tenant_id)
  values (v_owner,
          coalesce((select email from auth.users where id = v_owner), ''),
          v_oname, 'administrador', true, v_tenant)
  on conflict (id) do update
    set role = 'administrador', active = true, tenant_id = v_tenant,
        full_name = coalesce(nullif(excluded.full_name,''), profiles.full_name);

  insert into sucursales (tenant_id, code, name)
  values (v_tenant, gen_sucursal_code(), 'Sucursal Principal')
  returning id into v_suc;

  update profiles set default_sucursal_id = v_suc where id = v_owner;

  insert into user_sucursales (user_id, sucursal_id)
  values (v_owner, v_suc) on conflict do nothing;

  insert into registers (sucursal_id, name) values (v_suc, 'Caja 1');

  perform seed_default_permissions();

  insert into subscriptions (tenant_id, plan_code, status, trial_ends_at)
  values (v_tenant, v_plan, 'trialing',
          now() + (v_trial || ' days')::interval)
  on conflict (tenant_id) do nothing;

  return jsonb_build_object(
    'tenant_id', v_tenant, 'slug', v_slug, 'sucursal_id', v_suc);
end $$;

-- Valida límites del plan ANTES de crear sucursal/usuario.
create or replace function assert_plan_limits(p_tenant uuid, p_kind text)
returns void
language plpgsql stable security definer set search_path = public as $$
declare v_max int; v_count int;
begin
  if p_kind = 'sucursal' then
    select max_sucursales into v_max from plans
      where code = (select plan_code from tenants where id = p_tenant);
    select count(*) into v_count from sucursales where tenant_id = p_tenant;
  elsif p_kind = 'user' then
    select max_users into v_max from plans
      where code = (select plan_code from tenants where id = p_tenant);
    select count(*) into v_count from profiles where tenant_id = p_tenant;
  else
    return;
  end if;
  if v_count >= v_max then
    raise exception 'PLAN_LIMIT: límite de % alcanzado (% / %)',
      p_kind, v_count, v_max using errcode = 'check_violation';
  end if;
end $$;

create or replace function set_tenant_status(p_tenant uuid, p_status text)
returns void
language sql security definer set search_path = public as $$
  update tenants set status = p_status::tenant_status where id = p_tenant;
$$;
