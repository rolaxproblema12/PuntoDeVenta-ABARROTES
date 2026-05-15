-- 0012_indexes: índices de búsqueda (trigram) y consultas frecuentes.

create index if not exists idx_products_name_trgm
  on products using gin (name gin_trgm_ops);
create index if not exists idx_products_sku
  on products (sucursal_id, sku);
create index if not exists idx_products_active
  on products (sucursal_id) where active;

create index if not exists idx_barcodes_code
  on product_barcodes (barcode);

create index if not exists idx_sale_items_product
  on sale_items (sucursal_id, product_id);
create index if not exists idx_sale_items_sale
  on sale_items (sale_id);

create index if not exists idx_sales_status
  on sales (sucursal_id, status, created_at desc);

create index if not exists idx_credit_mov_customer
  on customer_credit_movements (customer_id, created_at desc);

create index if not exists idx_po_supplier
  on purchase_orders (sucursal_id, supplier_id, status);

create index if not exists idx_sync_queue_status
  on sync_queue (sucursal_id, status, created_at);
