-- 0011_report_views: vistas de reportes/alertas (security_invoker → respetan RLS).

create or replace view v_low_stock as
select bs.sucursal_id, bs.product_id, p.name, bs.stock, p.min_stock
from branch_stock bs
join products p on p.id = bs.product_id
where bs.stock <= p.min_stock and p.active;

create or replace view v_expiring_lots as
select l.sucursal_id, l.product_id, p.name, l.lot_code,
       l.qty_remaining, l.expiry_date,
       (l.expiry_date - current_date) as days_left
from lots l
join products p on p.id = l.product_id
where l.qty_remaining > 0 and l.expiry_date is not null
  and l.expiry_date <= current_date + interval '30 days';

create or replace view v_sales_daily as
select sucursal_id,
       date_trunc('day', created_at) as day,
       count(*) filter (where status = 'completada')      as ventas,
       coalesce(sum(total) filter (where status = 'completada'),0) as total,
       coalesce(sum(tax_total) filter (where status = 'completada'),0) as iva
from sales
group by sucursal_id, date_trunc('day', created_at);

create or replace view v_top_products as
select si.sucursal_id, si.product_id, p.name,
       sum(si.quantity)   as qty_sold,
       sum(si.line_total) as revenue
from sale_items si
join sales s on s.id = si.sale_id and s.status = 'completada'
join products p on p.id = si.product_id
group by si.sucursal_id, si.product_id, p.name;

create or replace view v_kardex as
select m.sucursal_id, m.product_id, m.created_at, m.kind, m.quantity,
       sum(m.quantity) over (
         partition by m.sucursal_id, m.product_id
         order by m.created_at, m.id) as running_balance
from inventory_movements m;

do $$ begin
  alter view v_low_stock      set (security_invoker = true);
  alter view v_expiring_lots  set (security_invoker = true);
  alter view v_sales_daily    set (security_invoker = true);
  alter view v_top_products   set (security_invoker = true);
  alter view v_kardex         set (security_invoker = true);
exception when others then null; end $$;
