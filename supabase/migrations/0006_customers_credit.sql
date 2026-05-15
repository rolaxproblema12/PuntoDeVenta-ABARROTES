-- 0006_customers_credit: clientes, crédito/abonos, lealtad. Centavos (bigint).

create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  sucursal_id     uuid not null references sucursales(id) on delete cascade,
  name            text not null,
  phone           text,
  email           text,
  rfc             text,
  credit_limit    bigint not null default 0,
  current_balance bigint not null default 0,
  frequent        boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references profiles(id),
  updated_at      timestamptz
);
call apply_sucursal_rls('customers');
create index if not exists idx_customers_name on customers using gin (name gin_trgm_ops);
create index if not exists idx_customers_phone on customers (phone);

-- FK diferida lógica: sales.customer_id → customers.id
do $$ begin
  alter table sales
    add constraint fk_sales_customer
    foreign key (customer_id) references customers(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists customer_credit_movements (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,
  sucursal_id   uuid not null references sucursales(id) on delete cascade,
  kind          text not null check (kind in ('cargo','abono')),
  amount        bigint not null check (amount > 0),
  sale_id       uuid references sales(id),
  balance_after bigint not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references profiles(id)
);
call apply_sucursal_rls('customer_credit_movements');

-- Mantiene customers.current_balance al insertar movimientos.
create or replace function apply_credit_movement() returns trigger
language plpgsql as $$
declare v_bal bigint;
begin
  select current_balance into v_bal from customers
    where id = new.customer_id for update;
  v_bal := coalesce(v_bal,0) + case when new.kind = 'cargo'
             then new.amount else -new.amount end;
  update customers set current_balance = v_bal where id = new.customer_id;
  new.balance_after := v_bal;
  return new;
end $$;
drop trigger if exists trg_credit_movement on customer_credit_movements;
create trigger trg_credit_movement before insert on customer_credit_movements
  for each row execute function apply_credit_movement();

create table if not exists loyalty_accounts (
  customer_id    uuid not null references customers(id) on delete cascade,
  sucursal_id    uuid not null references sucursales(id) on delete cascade,
  points_balance int not null default 0,
  primary key (customer_id, sucursal_id)
);
call apply_sucursal_rls('loyalty_accounts');

create table if not exists loyalty_movements (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  sucursal_id uuid not null references sucursales(id) on delete cascade,
  points      int not null,
  sale_id     uuid references sales(id),
  created_at  timestamptz not null default now()
);
call apply_sucursal_rls('loyalty_movements');
