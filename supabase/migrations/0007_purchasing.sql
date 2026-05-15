-- 0007_purchasing: órdenes de compra, recepción, cuentas por pagar. Centavos.

create table if not exists purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  folio       text not null,
  supplier_id uuid not null references suppliers(id),
  status      text not null default 'borrador'
                check (status in
                  ('borrador','enviada','parcial','recibida','cancelada')),
  expected_at timestamptz,
  total       bigint not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references profiles(id),
  updated_at  timestamptz,
  unique (sucursal_id, folio)
);
call apply_sucursal_rls('purchase_orders');

create table if not exists po_items (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references purchase_orders(id) on delete cascade,
  product_id   uuid not null references products(id),
  qty_ordered  numeric(14,3) not null check (qty_ordered > 0),
  qty_received numeric(14,3) not null default 0,
  unit_cost    bigint not null default 0
);
alter table po_items enable row level security;
do $$ begin
  create policy po_items_rls on po_items for all
    using (exists (select 1 from purchase_orders po where po.id = po_id
            and is_active_user_in_sucursal(po.sucursal_id)))
    with check (exists (select 1 from purchase_orders po where po.id = po_id
            and is_active_user_in_sucursal(po.sucursal_id)));
exception when duplicate_object then null; end $$;

create table if not exists goods_receipts (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references purchase_orders(id),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  received_at timestamptz not null default now(),
  created_by  uuid references profiles(id)
);
call apply_sucursal_rls('goods_receipts');

create table if not exists goods_receipt_items (
  id                uuid primary key default gen_random_uuid(),
  goods_receipt_id  uuid not null references goods_receipts(id) on delete cascade,
  product_id        uuid not null references products(id),
  qty_received      numeric(14,3) not null check (qty_received > 0),
  unit_cost         bigint not null default 0,
  lot_id            uuid references lots(id)
);
alter table goods_receipt_items enable row level security;
do $$ begin
  create policy gri_rls on goods_receipt_items for all
    using (exists (select 1 from goods_receipts g where g.id = goods_receipt_id
            and is_active_user_in_sucursal(g.sucursal_id)))
    with check (exists (select 1 from goods_receipts g where g.id = goods_receipt_id
            and is_active_user_in_sucursal(g.sucursal_id)));
exception when duplicate_object then null; end $$;

create table if not exists accounts_payable (
  id          uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  po_id       uuid references purchase_orders(id),
  amount      bigint not null default 0,
  paid        bigint not null default 0,
  due_date    date,
  status      text not null default 'pendiente'
                check (status in ('pendiente','parcial','pagada')),
  created_at  timestamptz not null default now()
);
call apply_sucursal_rls('accounts_payable');
