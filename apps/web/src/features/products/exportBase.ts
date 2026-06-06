import { fromCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';

/**
 * Exporta la base del catálogo a un CSV REIMPORTABLE (round-trip con
 * ImportProductsModal): mismas columnas canónicas, dinero en pesos, código de
 * barras incluido (sin él el importador no deduplicaría). Sirve como respaldo y
 * para mover la base entre sucursales/instalaciones.
 *
 * `existencia` se exporta SOLO para productos que tienen registro en branch_stock
 * (control de inventario); para el resto va en blanco, de modo que al reimportar
 * NO se fuerce su stock a 0.
 *
 * Limitación conocida: se exporta UN código por producto (el principal). Los
 * códigos secundarios / packs (product_barcodes adicionales) no viajan en este
 * CSV; al restaurar sobre una base vacía habría que recargarlos aparte.
 */

interface PriceRow {
  price: number;
  cost: number;
  price_list_id: string;
  min_qty: number;
}
interface ProductRow {
  id: string;
  sku: string;
  name: string;
  is_weighed: boolean;
  base_unit: string;
  active: boolean;
  tax_rate: number;
  category_id: string | null;
  product_barcodes: { barcode: string }[] | null;
  product_prices: PriceRow[] | null;
}

const COLS = [
  'codigo',
  'descripcion',
  'tipo_venta',
  'costo',
  'precio',
  'mayoreo',
  'existencia',
  'iva',
  'departamento',
  'activo',
] as const;

export async function buildBaseCsv(sucursalId: string): Promise<{ csv: string; count: number }> {
  const { data: products, error } = await supabase
    .from('products')
    .select(
      'id, sku, name, is_weighed, base_unit, active, tax_rate, category_id, product_barcodes(barcode), product_prices(price, cost, price_list_id, min_qty)',
    )
    .eq('sucursal_id', sucursalId)
    .order('name')
    .limit(100000);
  if (error) throw new Error(error.message);
  const rows = (products ?? []) as unknown as ProductRow[];

  const [{ data: lists }, { data: cats }, { data: stock }] = await Promise.all([
    supabase.from('price_lists').select('id, type').eq('sucursal_id', sucursalId),
    supabase.from('categories').select('id, name'),
    supabase.from('branch_stock').select('product_id, stock').eq('sucursal_id', sucursalId),
  ]);
  const listType = new Map((lists ?? []).map((l) => [l.id as string, l.type as string]));
  const catName = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
  const stockBy = new Map((stock ?? []).map((s) => [s.product_id as string, Number(s.stock)]));

  const priceFor = (pp: PriceRow[] | null, type: string) =>
    (pp ?? []).find((p) => listType.get(p.price_list_id) === type && Number(p.min_qty) === 1);

  const lines = rows.map((p) => {
    const menudeo = priceFor(p.product_prices, 'menudeo');
    const mayoreo = priceFor(p.product_prices, 'mayoreo');
    const codigo = p.product_barcodes?.[0]?.barcode ?? p.sku;
    const exi = stockBy.has(p.id) ? String(stockBy.get(p.id)) : '';
    const rec: Record<(typeof COLS)[number], string | number> = {
      codigo,
      descripcion: p.name,
      tipo_venta: p.is_weighed || p.base_unit === 'peso' ? 'granel' : 'pieza',
      costo: fromCents(menudeo?.cost ?? 0),
      precio: fromCents(menudeo?.price ?? 0),
      mayoreo: mayoreo ? fromCents(mayoreo.price) : 0,
      existencia: exi,
      iva: p.tax_rate ?? 0,
      departamento: p.category_id ? catName.get(p.category_id) ?? '' : '',
      activo: p.active ? '1' : '0',
    };
    return COLS.map((c) => csvCell(rec[c])).join(',');
  });

  // BOM para Excel; construido por código para no incrustar un carácter invisible.
  const bom = String.fromCharCode(0xfeff);
  const csv = bom + COLS.join(',') + '\r\n' + lines.join('\r\n');
  return { csv, count: rows.length };
}

export async function downloadBaseCsv(sucursalId: string, businessLabel: string): Promise<number> {
  const { csv, count } = await buildBaseCsv(sucursalId);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = businessLabel.replace(/[^\w-]+/g, '_').slice(0, 40) || 'base';
  a.href = url;
  a.download = `respaldo-base-${safe}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return count;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
