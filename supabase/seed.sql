-- seed.sql — datos de ejemplo para desarrollo (idempotente).
-- Usuarios demo: <rol>@pos.local / contraseña: password123

-- ── Sucursales ───────────────────────────────────────────────────────────────
insert into sucursales (id, code, name, address) values
  ('11111111-1111-1111-1111-111111111111','MX','Tienda Centro','Av. Juárez 100'),
  ('22222222-2222-2222-2222-222222222222','GD','Tienda Norte','Blvd. Norte 250')
on conflict (id) do nothing;

-- ── Usuarios (auth.users → trigger crea profiles) ────────────────────────────
do $$
declare
  u record;
  users jsonb := jsonb_build_array(
    jsonb_build_object('id','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'email','admin@pos.local','role','administrador','name','Admin Demo'),
    jsonb_build_object('id','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'email','super@pos.local','role','supervisor','name','Supervisor Demo'),
    jsonb_build_object('id','cccccccc-cccc-cccc-cccc-cccccccccccc',
      'email','encargado@pos.local','role','encargado','name','Encargado Demo'),
    jsonb_build_object('id','dddddddd-dddd-dddd-dddd-dddddddddddd',
      'email','cajero@pos.local','role','cajero','name','Cajero Demo'));
begin
  for u in select * from jsonb_array_elements(users) as e(v) loop
    insert into auth.users (instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000',
      (u.v->>'id')::uuid, 'authenticated','authenticated', u.v->>'email',
      crypt('password123', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', u.v->>'name'))
    on conflict (id) do nothing;

    update profiles
      set role = (u.v->>'role')::user_role,
          active = true,
          full_name = u.v->>'name',
          default_sucursal_id = '11111111-1111-1111-1111-111111111111'
    where id = (u.v->>'id')::uuid;

    insert into user_sucursales (user_id, sucursal_id) values
      ((u.v->>'id')::uuid,'11111111-1111-1111-1111-111111111111'),
      ((u.v->>'id')::uuid,'22222222-2222-2222-2222-222222222222')
    on conflict do nothing;
  end loop;
end $$;

-- ── Cajas + lista de precios + categorías + proveedor ────────────────────────
insert into registers (id, sucursal_id, name) values
  ('e1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Caja 1'),
  ('e1111111-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Caja 2'),
  ('e2222222-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Caja 1')
on conflict (id) do nothing;

insert into price_lists (id, sucursal_id, name, type) values
  ('f1111111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Menudeo','menudeo')
on conflict (id) do nothing;

insert into categories (id, sucursal_id, name) values
  ('c0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Botanas'),
  ('c0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Bebidas'),
  ('c0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Alcohol'),
  ('c0000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Cigarros'),
  ('c0000000-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','Dulces'),
  ('c0000000-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','Limpieza'),
  ('c0000000-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111','Lácteos'),
  ('c0000000-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','Abarrotes')
on conflict (id) do nothing;

insert into suppliers (id, sucursal_id, name, frequent) values
  ('5a000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Distribuidora Central',true)
on conflict (id) do nothing;

-- ── ~30 productos con código de barras + stock inicial ───────────────────────
do $$
declare
  i int := 0;
  pid uuid;
  rows jsonb := jsonb_build_array(
    jsonb_build_object('n','Sabritas Original 45g','c',1,'p',1800,'co',1200,'b','7501011101001'),
    jsonb_build_object('n','Doritos Nacho 62g','c',1,'p',2000,'co',1300,'b','7501011101002'),
    jsonb_build_object('n','Cheetos Torciditos 54g','c',1,'p',1800,'co',1150,'b','7501011101003'),
    jsonb_build_object('n','Ruffles Queso 45g','c',1,'p',1800,'co',1200,'b','7501011101004'),
    jsonb_build_object('n','Coca-Cola 600ml','c',2,'p',1800,'co',1200,'b','7501011101005'),
    jsonb_build_object('n','Pepsi 600ml','c',2,'p',1700,'co',1100,'b','7501011101006'),
    jsonb_build_object('n','Agua Bonafont 1L','c',2,'p',1500,'co',900,'b','7501011101007'),
    jsonb_build_object('n','Jugo Del Valle 413ml','c',2,'p',1600,'co',1000,'b','7501011101008'),
    jsonb_build_object('n','Cerveza Corona 355ml','c',3,'p',2500,'co',1700,'b','7501011101009','age',true),
    jsonb_build_object('n','Cerveza Tecate 355ml','c',3,'p',2200,'co',1500,'b','7501011101010','age',true),
    jsonb_build_object('n','Tequila Cuervo 750ml','c',3,'p',24900,'co',18000,'b','7501011101011','age',true),
    jsonb_build_object('n','Cigarros Marlboro','c',4,'p',7000,'co',5800,'b','7501011101012','age',true),
    jsonb_build_object('n','Cigarros Camel','c',4,'p',6800,'co',5600,'b','7501011101013','age',true),
    jsonb_build_object('n','Paleta Payaso','c',5,'p',1500,'co',900,'b','7501011101014'),
    jsonb_build_object('n','Chocolate Carlos V','c',5,'p',1200,'co',700,'b','7501011101015'),
    jsonb_build_object('n','Chicle Trident','c',5,'p',1500,'co',900,'b','7501011101016'),
    jsonb_build_object('n','Mazapán De la Rosa','c',5,'p',800,'co',450,'b','7501011101017'),
    jsonb_build_object('n','Cloralex 950ml','c',6,'p',2200,'co',1400,'b','7501011101018'),
    jsonb_build_object('n','Fabuloso 1L','c',6,'p',2800,'co',1900,'b','7501011101019'),
    jsonb_build_object('n','Jabón Zote 400g','c',6,'p',2000,'co',1300,'b','7501011101020'),
    jsonb_build_object('n','Papel Higiénico 4 rollos','c',6,'p',3500,'co',2400,'b','7501011101021'),
    jsonb_build_object('n','Leche Lala 1L','c',7,'p',2800,'co',2100,'b','7501011101022'),
    jsonb_build_object('n','Yogurt Danone 1L','c',7,'p',3200,'co',2400,'b','7501011101023'),
    jsonb_build_object('n','Queso Oaxaca 200g','c',7,'p',4500,'co',3400,'b','7501011101024'),
    jsonb_build_object('n','Huevo 12 pzas','c',8,'p',4200,'co',3300,'b','7501011101025'),
    jsonb_build_object('n','Arroz 1kg','c',8,'p',3200,'co',2400,'b','7501011101026'),
    jsonb_build_object('n','Frijol 1kg','c',8,'p',3800,'co',2900,'b','7501011101027'),
    jsonb_build_object('n','Aceite 1L','c',8,'p',4500,'co',3500,'b','7501011101028'),
    jsonb_build_object('n','Azúcar 1kg','c',8,'p',3000,'co',2200,'b','7501011101029'),
    jsonb_build_object('n','Sal de mesa 1kg','c',8,'p',1500,'co',900,'b','7501011101030'));
  row jsonb;
begin
  for row in select * from jsonb_array_elements(rows) loop
    i := i + 1;
    pid := ('a0000000-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid;
    insert into products (id, sucursal_id, sku, name, category_id, base_unit,
                          age_restricted, tax_rate, track_lots, track_expiry,
                          min_stock)
    values (pid,'11111111-1111-1111-1111-111111111111',
            'SKU' || lpad(i::text,3,'0'), row->>'n',
            ('c0000000-0000-0000-0000-00000000000' || (row->>'c'))::uuid,
            'pieza', coalesce((row->>'age')::boolean,false), 0.16,
            true, true, 5)
    on conflict (id) do nothing;

    insert into product_barcodes (product_id, barcode) values (pid, row->>'b')
    on conflict (barcode) do nothing;

    insert into product_prices (product_id, price_list_id, price, cost)
    values (pid,'f1111111-0000-0000-0000-000000000001',
            (row->>'p')::bigint, (row->>'co')::bigint)
    on conflict do nothing;

    -- Lote + entrada de stock inicial (50 piezas) vía movimiento.
    insert into lots (id, product_id, sucursal_id, lot_code, qty_received,
                       qty_remaining, cost, expiry_date)
    values (gen_random_uuid(), pid,'11111111-1111-1111-1111-111111111111',
            'L-' || lpad(i::text,3,'0'), 50, 50, (row->>'co')::bigint,
            current_date + interval '180 days');

    insert into inventory_movements (sucursal_id, product_id, kind, quantity,
                                     unit_cost, ref_type)
    values ('11111111-1111-1111-1111-111111111111', pid,'entrada', 50,
            (row->>'co')::bigint,'seed');
  end loop;
end $$;
