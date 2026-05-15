-- 0013_seed_helpers: matriz de permisos por defecto + helper de PIN de seed.

-- Acciones gateadas y qué rol mínimo las permite por defecto.
create or replace function seed_default_permissions() returns void
language plpgsql as $$
declare
  r user_role;
  a text;
  actions text[] := array[
    'sale.create','sale.cancel','return.create','price.override',
    'cash.open','cash.close','cash.close_with_difference',
    'inventory.adjust','inventory.transfer','product.manage',
    'customer.manage','credit.over_limit','purchase.manage',
    'reports.view','reports.multi_sucursal','users.manage','settings.manage'];
  min_rank int;
begin
  foreach a in array actions loop
    min_rank := case a
      when 'sale.create'                then 1
      when 'cash.open'                  then 1
      when 'cash.close'                 then 2
      when 'sale.cancel'                then 2
      when 'return.create'              then 2
      when 'inventory.adjust'           then 2
      when 'inventory.transfer'         then 2
      when 'product.manage'             then 2
      when 'customer.manage'            then 2
      when 'purchase.manage'            then 2
      when 'price.override'             then 3
      when 'cash.close_with_difference' then 3
      when 'credit.over_limit'          then 3
      when 'reports.view'               then 3
      when 'reports.multi_sucursal'     then 3
      when 'users.manage'               then 4
      when 'settings.manage'            then 4
      else 4 end;

    for r in select unnest(enum_range(NULL::user_role)) loop
      insert into permissions (role, action_key, allowed)
      values (r, a,
        case r
          when 'cajero' then 1 when 'encargado' then 2
          when 'supervisor' then 3 when 'administrador' then 4
        end >= min_rank)
      on conflict (role, action_key) do update set allowed = excluded.allowed;
    end loop;
  end loop;
end $$;

select seed_default_permissions();
