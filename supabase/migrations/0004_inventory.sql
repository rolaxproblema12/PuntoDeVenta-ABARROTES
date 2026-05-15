-- 0004_inventory: lotes, stock por sucursal, movimientos, transferencias.
-- Stock materializado vía trigger delta con bloqueo FOR UPDATE (anti-race).

create table if not exists lots (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  sucursal_id  uuid not null references sucursales(id) on delete cascade,
  lot_code     text not null,
  qty_received numeric(14,3) not null default 0,
  qty_remaining numeric(14,3) not null default 0,
  cost         bigint not null default 0,           -- centavos
  expiry_date  date,
  received_at  timestamptz not null default now()
);
call apply_sucursal_rls('lots');
create index if not exists idx_lots_fifo
  on lots (product_id, sucursal_id, expiry_date nulls last, received_at)
  where qty_remaining > 0;

create table if not exists branch_stock (
  product_id  uuid not null references products(id) on delete cascade,
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  stock       numeric(14,3) not null default 0,
  avg_cost    bigint not null default 0,            -- centavos
  updated_at  timestamptz not null default now(),
  primary key (product_id, sucursal_id),
  constraint chk_branch_stock_nonneg check (stock >= 0)
);
call apply_sucursal_rls('branch_stock');

create table if not exists inventory_movements (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  lot_id      uuid references lots(id) on delete set null,
  kind        text not null check (kind in
                ('entrada','salida','ajuste','transfer_in','transfer_out',
                 'venta','devolucion','merma')),
  quantity    numeric(14,3) not null,               -- con signo
  unit_cost   bigint not null default 0,            -- centavos
  ref_type    text,
  ref_id      uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id)
);
call apply_sucursal_rls('inventory_movements');
create index if not exists idx_movs_product
  on inventory_movements (sucursal_id, product_id, created_at);

-- ── Guarda de stock negativo + sincronización delta ──────────────────────────
create or replace function apply_inventory_movement() returns trigger
language plpgsql as $$
declare
  v_stock numeric(14,3);
begin
  -- Bloquea (o crea) la fila de stock para evitar carreras entre cajas.
  insert into branch_stock (product_id, sucursal_id, stock)
  values (new.product_id, new.sucursal_id, 0)
  on conflict (product_id, sucursal_id) do nothing;

  select stock into v_stock
  from branch_stock
  where product_id = new.product_id and sucursal_id = new.sucursal_id
  for update;

  if v_stock + new.quantity < 0 then
    raise exception 'STOCK_INSUFFICIENT: producto % en sucursal %',
      new.product_id, new.sucursal_id
      using errcode = 'check_violation';
  end if;

  update branch_stock
  set stock = stock + new.quantity,
      avg_cost = case
        when new.quantity > 0 and (stock + new.quantity) > 0
        then ((stock * avg_cost) + (new.quantity * new.unit_cost))
             / nullif(stock + new.quantity, 0)
        else avg_cost end,
      updated_at = now()
  where product_id = new.product_id and sucursal_id = new.sucursal_id;

  return new;
end $$;

drop trigger if exists trg_inventory_movement on inventory_movements;
create trigger trg_inventory_movement before insert on inventory_movements
  for each row execute function apply_inventory_movement();

-- ── Transferencias entre sucursales ──────────────────────────────────────────
create table if not exists transfers (
  id               uuid primary key default gen_random_uuid(),
  from_sucursal_id uuid not null references sucursales(id),
  to_sucursal_id   uuid not null references sucursales(id),
  status           text not null default 'borrador'
                     check (status in ('borrador','enviado','recibido','cancelado')),
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references profiles(id),
  updated_at       timestamptz
);
alter table transfers enable row level security;
do $$ begin
  create policy transfers_rls on transfers for all
    using (is_active_user_in_sucursal(from_sucursal_id)
           or is_active_user_in_sucursal(to_sucursal_id))
    with check (is_active_user_in_sucursal(from_sucursal_id)
           or is_active_user_in_sucursal(to_sucursal_id));
exception when duplicate_object then null; end $$;

create table if not exists transfer_items (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references transfers(id) on delete cascade,
  product_id  uuid not null references products(id),
  quantity    numeric(14,3) not null check (quantity > 0)
);
alter table transfer_items enable row level security;
do $$ begin
  create policy transfer_items_rls on transfer_items for all
    using (exists (select 1 from transfers t where t.id = transfer_id
            and (is_active_user_in_sucursal(t.from_sucursal_id)
                 or is_active_user_in_sucursal(t.to_sucursal_id))))
    with check (exists (select 1 from transfers t where t.id = transfer_id
            and (is_active_user_in_sucursal(t.from_sucursal_id)
                 or is_active_user_in_sucursal(t.to_sucursal_id))));
exception when duplicate_object then null; end $$;
