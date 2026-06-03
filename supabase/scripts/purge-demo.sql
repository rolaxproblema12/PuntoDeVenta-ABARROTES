-- purge-demo.sql — elimina los datos demo del seed.sql de una base REAL.
-- Ejecutar UNA sola vez en Supabase Studio (SQL Editor, rol service_role).
-- Seguro de re-ejecutar: si los demo ya no están, cada paso afecta 0 filas.
-- Tu cuenta real (email propio/gmail) NO se toca: el filtro de usuarios solo
-- borra los demo @pos.local / @plataforma.local.
--
-- Orden dictado por las llaves foráneas (hay una dependencia circular):
--   profiles.default_sucursal_id → sucursales  (RESTRICT)  ⇒ romper primero.
--   products/inventory_movements.created_by → profiles (RESTRICT) ⇒ por eso las
--     sucursales (y su cascada de hijos) deben morir ANTES que los profiles.
--   profiles.id → auth.users (CASCADE) ⇒ borrar el usuario elimina su profile.
--
--   1) NULL a profiles.default_sucursal_id que apunte a una sucursal demo.
--   2) sucursales demo → cascada borra productos, lotes, movimientos, cajas,
--      ventas, categorías, proveedores, branch_stock, settings, sync_queue, etc.
--   3) usuarios demo → cascada borra sus profiles y su fila en platform_admins.
--   4) suscripciones demo.   5) tenants demo.

begin;

-- 1. Romper la referencia default_sucursal_id (RESTRICT) hacia sucursales demo.
update profiles set default_sucursal_id = null
where default_sucursal_id in (
  select id from sucursales where tenant_id in (
    'f0000001-0000-0000-0000-000000000001',
    'f0000002-0000-0000-0000-000000000002'
  )
);

-- 2. Datos por sucursal de ambos tenants demo (cascada en cadena).
delete from sucursales
where tenant_id in (
  'f0000001-0000-0000-0000-000000000001',
  'f0000002-0000-0000-0000-000000000002'
);

-- 3. Usuarios demo (cascada elimina profiles + platform_admins).
delete from auth.users
where email like '%@pos.local'
   or email like '%@plataforma.local';

-- 4. Suscripciones demo.
delete from subscriptions
where tenant_id in (
  'f0000001-0000-0000-0000-000000000001',
  'f0000002-0000-0000-0000-000000000002'
);

-- 5. Tenants demo.
delete from tenants
where id in (
  'f0000001-0000-0000-0000-000000000001',
  'f0000002-0000-0000-0000-000000000002'
);

commit;

-- ── Verificación: todo debe devolver 0 ───────────────────────────────────────
-- select count(*) as tenants_demo from tenants where slug in ('demo-a','demo-b');
-- select count(*) as sucursales_demo from sucursales where code in ('MX','GD','BB');
-- select count(*) as usuarios_demo from auth.users where email like '%@pos.local';
