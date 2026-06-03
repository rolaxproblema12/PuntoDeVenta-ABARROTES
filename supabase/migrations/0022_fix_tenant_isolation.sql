-- 0022_fix_tenant_isolation: cierra la fuga de datos entre tenants.
--
-- Causa: is_admin() (0001_init.sql:82) NO es tenant-aware (solo mira
--   role='administrador') y se usaba como bypass `using (is_admin() or ...)` en
--   políticas RLS de tablas de negocio, anulando el aislamiento que sí hace
--   is_active_user_in_sucursal() (reescrita tenant-aware en 0014_tenancy.sql).
--   Efecto: un administrador de un tenant podía leer —y en varias tablas
--   escribir— filas de OTROS tenants (sucursales, perfiles, settings, etc.).
--
-- NO se editan migraciones previas (regla del proyecto). Idempotente:
-- `drop policy if exists` + `create policy` reemplaza la política con fuga.

-- ── Helper: administrador DEL MISMO tenant (o super-admin de plataforma) ──────
-- NULL seguro: exige igualdad estricta con ambos tenant_id NOT NULL, evitando el
-- (NULL = NULL → TRUE) que dejaría verse entre sí a filas legacy sin tenant.
create or replace function is_tenant_admin(p_tenant uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.active
      and p.role = 'administrador'
      and p.tenant_id is not null
      and p_tenant is not null
      and p.tenant_id = p_tenant
  );
$$;

-- ── sucursales (orig. 0001_init.sql:109-116) ─────────────────────────────────
-- Lectura: is_active_user_in_sucursal ya admite al admin del MISMO tenant; se
-- elimina el bypass is_admin() que mostraba sucursales de otros negocios.
drop policy if exists sucursales_read on sucursales;
create policy sucursales_read on sucursales for select
  using (is_active_user_in_sucursal(id));

drop policy if exists sucursales_admin on sucursales;
create policy sucursales_admin on sucursales for all
  using (is_tenant_admin(tenant_id))
  with check (is_tenant_admin(tenant_id));

-- ── profiles (orig. 0001_init.sql:118-125) ───────────────────────────────────
drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles for select
  using (id = auth.uid() or is_tenant_admin(tenant_id));

drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles for all
  using (is_tenant_admin(tenant_id))
  with check (is_tenant_admin(tenant_id));

-- ── user_sucursales (orig. 0001_init.sql:127-134) — hereda tenant por sucursal ─
drop policy if exists user_sucursales_read on user_sucursales;
create policy user_sucursales_read on user_sucursales for select
  using (user_id = auth.uid() or is_active_user_in_sucursal(sucursal_id));

drop policy if exists user_sucursales_admin on user_sucursales;
create policy user_sucursales_admin on user_sucursales for all
  using (is_active_user_in_sucursal(sucursal_id))
  with check (is_active_user_in_sucursal(sucursal_id));

-- ── access_codes (orig. 0001_init.sql:144-147) ───────────────────────────────
-- Plataforma, o usuario activo en la sucursal del código (el admin del mismo
-- tenant lo es). Códigos globales (sucursal_id NULL) solo los gestiona plataforma.
drop policy if exists access_codes_admin on access_codes;
create policy access_codes_admin on access_codes for all
  using (is_platform_admin()
         or (sucursal_id is not null and is_active_user_in_sucursal(sucursal_id)))
  with check (is_platform_admin()
         or (sucursal_id is not null and is_active_user_in_sucursal(sucursal_id)));

-- ── permissions (orig. 0001_init.sql:139-142) — tabla GLOBAL de sistema ──────
-- Matriz rol→acción compartida entre tenants: solo plataforma la escribe (un
-- admin de tenant no debe alterar permisos de todos). permissions_read no cambia.
drop policy if exists permissions_admin on permissions;
create policy permissions_admin on permissions for all
  using (is_platform_admin())
  with check (is_platform_admin());

-- ── brands (orig. 0002_catalog.sql:41-43) — catálogo GLOBAL de marcas ────────
drop policy if exists brands_write on brands;
create policy brands_write on brands for all
  using (is_platform_admin())
  with check (is_platform_admin());

-- ── activity_log (orig. 0008_security_audit.sql:16-20) ───────────────────────
drop policy if exists activity_log_read on activity_log;
create policy activity_log_read on activity_log for select
  using (is_platform_admin()
         or (sucursal_id is not null and is_active_user_in_sucursal(sucursal_id)));

-- ── settings (orig. 0009_settings_sync.sql:16-19) ────────────────────────────
-- Escritura: plataforma (incluye scope='global' / sucursal_id NULL) o usuario
-- activo en la sucursal. settings_read no cambia.
drop policy if exists settings_admin on settings;
create policy settings_admin on settings for all
  using (is_platform_admin()
         or (sucursal_id is not null and is_active_user_in_sucursal(sucursal_id)))
  with check (is_platform_admin()
         or (sucursal_id is not null and is_active_user_in_sucursal(sucursal_id)));

-- ── Endurecer ancla tenant_id en sucursales (con guard) ──────────────────────
-- Cierra el hueco NULL=NULL de is_active_user_in_sucursal. Solo si no hay NULLs
-- (toda sucursal nace con tenant en provisioning y en SucursalesPage).
do $$ begin
  if not exists (select 1 from sucursales where tenant_id is null) then
    alter table sucursales alter column tenant_id set not null;
  else
    raise notice 'sucursales.tenant_id tiene NULLs: se omite SET NOT NULL';
  end if;
end $$;
