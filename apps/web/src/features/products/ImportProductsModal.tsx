import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Upload,
} from 'lucide-react';
import { saveProductSchema, patchProductSchema, setStockSchema, toCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui';

/**
 * Importador de mercancía. Toma el CSV/JSON del conversor local
 * (tools/fdb-import/extract.mjs, a partir del pdvdata.fdb de "Abarrotes Punto de
 * Venta") O cualquier CSV/Excel/JSON de usuario, mapea las columnas y da de alta
 * la mercancía SIN perder información existente:
 *   - Productos nuevos  → upsert_product (producto + precio menudeo + costo + código).
 *   - Duplicados (por código): se OMITEN por defecto; opcionalmente se actualiza
 *     SOLO precio/costo o los datos del archivo vía patch_product (merge NO
 *     destructivo: no borra IVA/categoría/proveedor ni códigos secundarios).
 *   - Existencias → set_stock_levels (ajuste absoluto e idempotente: re-importar
 *     no duplica stock).
 * Producción es serverless: el .fdb se convierte a archivo portátil en la PC y
 * aquí solo se importa ese archivo.
 */

interface Props {
  sucursalId: string;
  onClose: () => void;
  onDone: () => void;
}

type Phase = 'pick' | 'map' | 'preview' | 'running' | 'done';
type UpdateMode = 'skip' | 'price' | 'overwrite';

/** Campos canónicos que el importador entiende. */
const FIELDS = [
  { key: 'codigo', label: 'Código / SKU' },
  { key: 'descripcion', label: 'Descripción', required: true },
  { key: 'precio', label: 'Precio venta' },
  { key: 'costo', label: 'Costo' },
  { key: 'mayoreo', label: 'Precio mayoreo' },
  { key: 'existencia', label: 'Existencia / stock' },
  { key: 'iva', label: 'IVA (tasa)' },
  { key: 'departamento', label: 'Departamento' },
  { key: 'marca', label: 'Marca' },
  { key: 'proveedor', label: 'Proveedor' },
  { key: 'tipo_venta', label: 'Tipo (pieza/granel)' },
  { key: 'activo', label: 'Activo (1/0)' },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  codigo: ['codigo', 'código', 'sku', 'clave', 'barcode', 'codigo de barras', 'código de barras', 'cod', 'upc', 'ean'],
  descripcion: ['descripcion', 'descripción', 'nombre', 'producto', 'articulo', 'artículo', 'description'],
  precio: ['precio', 'pventa', 'precio venta', 'precio de venta', 'venta', 'precio_venta', 'p venta', 'precio publico', 'precio público', 'pvp'],
  costo: ['costo', 'pcosto', 'precio costo', 'costo unitario', 'compra', 'precio_costo', 'p costo', 'precio compra'],
  mayoreo: ['mayoreo', 'precio mayoreo', 'precio_mayoreo', 'wholesale', 'medio mayoreo'],
  existencia: ['existencia', 'existencias', 'stock', 'cantidad', 'inventario', 'exist', 'piezas', 'qty'],
  iva: ['iva', 'tax', 'impuesto', 'tasa', 'tasa iva', 'tax_rate'],
  departamento: ['departamento', 'depto', 'depart', 'categoria', 'categoría', 'familia', 'linea', 'línea', 'grupo', 'category'],
  marca: ['marca', 'brand'],
  proveedor: ['proveedor', 'supplier', 'provider', 'prov'],
  tipo_venta: ['tipo_venta', 'tipo venta', 'tventa', 'tipo', 'venta tipo', 'unidad', 'medida'],
  activo: ['activo', 'active', 'activa', 'estatus', 'status', 'habilitado', 'disponible'],
};

const SIN_DEPTO = '- Sin Departamento -';

interface ParsedRow {
  line: number;
  codigo: string;
  name: string;
  granel: boolean;
  precio: number; // pesos
  costo: number; // pesos
  mayoreo: number; // pesos (0 = sin mayoreo)
  existencia: number | null; // unidades; null = sin dato / sin control
  iva: number | null; // fracción 0..1; null = usar tasa global
  departamento: string;
  marca: string;
  proveedor: string;
  activo: boolean; // default true; columna 'activo' la puede desactivar
  error?: string;
  status?: 'nuevo' | 'duplicado';
  existingId?: string;
}

// ── helpers de normalización ──────────────────────────────────────────────────
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

/** Convierte texto a número tolerando formatos es-MX (1.234,50) y en-US (1,234.50). */
function toNumber(v: string): number {
  if (v == null) return 0;
  let s = String(v).replace(/[^0-9.,-]/g, '').trim();
  if (!s) return 0;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // el último separador es el decimal; el otro son miles
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // coma sola: decimal si hay 1-2 dígitos después, si no miles
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function isGranel(tipo: string): boolean {
  const n = norm(tipo);
  return n === 'granel' || n === 'peso' || n === 'd' || n === 'kg' || n === 'kilo' || n === 'kilogramo' || n === 'granes';
}

/** Interpreta un valor de "activo". Vacío/ausente ⇒ true (default). */
function parseActivo(v: string): boolean {
  const n = norm(v);
  if (!n) return true;
  return !['0', 'no', 'false', 'inactivo', 'inactiva', 'n', 'baja', 'deshabilitado'].includes(n);
}

// Parser CSV mínimo con comillas (RFC4180), tolerante a , o ;
function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  const firstLine = t.split('\n')[0] ?? '';
  const delim =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
  }
  return rows;
}

/** Lee un archivo (CSV / XLSX / JSON) a una matriz [headers, ...filas]. */
async function fileToTable(file: File): Promise<string[][]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const wsName = wb.SheetNames[0];
    const ws = wsName ? wb.Sheets[wsName] : undefined;
    if (!ws) throw new Error('El Excel no tiene hojas.');
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
    return aoa.map((r) => r.map((c) => (c == null ? '' : String(c))));
  }
  const text = await file.text();
  if (lower.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.productos;
    if (!Array.isArray(arr)) throw new Error('JSON sin arreglo de productos.');
    const keys = [...new Set(arr.flatMap((o: Record<string, unknown>) => Object.keys(o)))];
    const rows = arr.map((o: Record<string, unknown>) =>
      keys.map((k) => (o[k] == null ? '' : String(o[k]))),
    );
    return [keys, ...rows];
  }
  return parseCsv(text);
}

/** Mapeo automático header→campo canónico (índice de columna, -1 = ninguno). */
function autoMap(headers: string[]): Record<FieldKey, number> {
  const map = {} as Record<FieldKey, number>;
  for (const f of FIELDS) map[f.key] = -1;
  headers.forEach((cell, i) => {
    const n = norm(cell);
    for (const f of FIELDS) {
      if (map[f.key] === -1 && HEADER_ALIASES[f.key].includes(n)) map[f.key] = i;
    }
  });
  return map;
}

function buildRows(table: string[][], map: Record<FieldKey, number>): ParsedRow[] {
  const at = (cells: string[], key: FieldKey): string => {
    const i = map[key];
    return i >= 0 ? (cells[i] ?? '').trim() : '';
  };
  return table.slice(1).map((cells, idx) => {
    const line = idx + 2;
    const name = at(cells, 'descripcion').slice(0, 160);
    const codigo = at(cells, 'codigo').slice(0, 64);
    const exiStr = at(cells, 'existencia');
    const ivaStr = at(cells, 'iva');
    let iva: number | null = null;
    if (ivaStr) {
      let n = toNumber(ivaStr);
      if (n > 1) n = n / 100; // 16 → 0.16
      iva = Math.min(1, Math.max(0, n));
    }
    const exi = exiStr ? toNumber(exiStr) : NaN;
    const row: ParsedRow = {
      line,
      codigo,
      name,
      granel: isGranel(at(cells, 'tipo_venta')),
      precio: at(cells, 'precio') ? round2(toNumber(at(cells, 'precio'))) : 0,
      costo: at(cells, 'costo') ? round2(toNumber(at(cells, 'costo'))) : 0,
      mayoreo: at(cells, 'mayoreo') ? round2(toNumber(at(cells, 'mayoreo'))) : 0,
      existencia: Number.isFinite(exi) && exi >= 0 ? exi : null,
      iva,
      departamento: at(cells, 'departamento'),
      marca: at(cells, 'marca'),
      proveedor: at(cells, 'proveedor'),
      activo: parseActivo(at(cells, 'activo')),
    };
    if (!name) row.error = 'Sin descripción';
    else if (row.precio < 0 || row.costo < 0) row.error = 'Precio/costo negativo';
    return row;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── pool de concurrencia ──────────────────────────────────────────────────────
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item === undefined) continue;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function ImportProductsModal({ sucursalId, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<FieldKey, number>>(() => autoMap([]));
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [taxRate, setTaxRate] = useState(0); // abarrotes: la mayoría 0% IVA
  const [updateMode, setUpdateMode] = useState<UpdateMode>('skip');
  const [importStock, setImportStock] = useState(true);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [result, setResult] = useState({ created: 0, updated: 0, skipped: 0, failed: 0, stock: 0 });
  const [failures, setFailures] = useState<{ row: ParsedRow; reason: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const headers = table[0] ?? [];
  const valid = useMemo(() => rows.filter((r) => !r.error), [rows]);
  const invalid = useMemo(() => rows.filter((r) => r.error), [rows]);
  const dups = useMemo(() => valid.filter((r) => r.status === 'duplicado'), [valid]);
  const news = useMemo(() => valid.filter((r) => r.status === 'nuevo'), [valid]);
  const withStock = useMemo(() => valid.filter((r) => r.existencia != null), [valid]);
  const depts = useMemo(
    () => [...new Set(valid.map((r) => r.departamento).filter((d) => d && norm(d) !== norm(SIN_DEPTO)))],
    [valid],
  );
  const provs = useMemo(
    () => [...new Set(valid.map((r) => r.proveedor).filter(Boolean))],
    [valid],
  );

  // ── lectura del archivo → tabla → mapeo ─────────────────────────────────────
  async function onFile(file: File) {
    try {
      const t = await fileToTable(file);
      if (t.length < 2) throw new Error('El archivo no tiene filas de datos.');
      const auto = autoMap(t[0] ?? []);
      setFileName(file.name);
      setTable(t);
      setMap(auto);
      if (auto.descripcion < 0 && auto.codigo < 0) {
        setPhase('map'); // no se reconocieron columnas → mapeo manual
      } else {
        await classify(t, auto);
        setPhase('preview');
      }
    } catch (e) {
      toast.error(`No se pudo leer el archivo: ${(e as Error).message}`);
    }
  }

  async function classify(t: string[][], m: Record<FieldKey, number>) {
    const parsed = buildRows(t, m);
    const codes = [...new Set(parsed.map((r) => r.codigo).filter(Boolean))];
    // Dedupe por código de barras Y por SKU, consultando SOLO los códigos del
    // archivo en lotes (evita el tope de filas de PostgREST en catálogos grandes).
    const existing = new Map<string, string>();
    for (const part of chunk(codes, 200)) {
      const [bc, sk] = await Promise.all([
        supabase.from('product_barcodes').select('barcode, product_id').eq('sucursal_id', sucursalId).in('barcode', part),
        supabase.from('products').select('id, sku').eq('sucursal_id', sucursalId).in('sku', part),
      ]);
      for (const b of bc.data ?? []) existing.set(b.barcode, b.product_id);
      for (const p of sk.data ?? []) if (!existing.has(p.sku)) existing.set(p.sku, p.id);
    }
    for (const r of parsed) {
      if (r.error) continue;
      const id = r.codigo ? existing.get(r.codigo) : undefined;
      r.status = id ? 'duplicado' : 'nuevo';
      r.existingId = id;
    }
    setRows(parsed);
  }

  async function confirmMapping() {
    if (map.descripcion < 0) {
      toast.error('Mapea al menos la columna de Descripción.');
      return;
    }
    await classify(table, map);
    setPhase('preview');
  }

  // ── find-or-create de categorías y proveedores ──────────────────────────────
  async function resolveCategories(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    // Incluye categorías de la sucursal Y las globales (sucursal_id null): así un
    // departamento que ya existe como global se reutiliza, no se recrea local.
    const { data } = await supabase
      .from('categories')
      .select('id, name, sucursal_id')
      .or(`sucursal_id.eq.${sucursalId},sucursal_id.is.null`);
    for (const c of data ?? []) if (!m.has(norm(c.name))) m.set(norm(c.name), c.id);
    const missing = depts.filter((d) => !m.has(norm(d)));
    if (missing.length) {
      const { data: ins, error } = await supabase
        .from('categories')
        .insert(missing.map((name) => ({ sucursal_id: sucursalId, name })))
        .select('id, name');
      if (error) throw new Error(`Categorías: ${error.message}`);
      for (const c of ins ?? []) m.set(norm(c.name), c.id);
    }
    return m;
  }

  async function resolveSuppliers(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    if (!provs.length) return m;
    const { data } = await supabase.from('suppliers').select('id, name').eq('sucursal_id', sucursalId);
    for (const s of data ?? []) m.set(norm(s.name), s.id);
    const missing = provs.filter((p) => !m.has(norm(p)));
    if (missing.length) {
      const { data: ins, error } = await supabase
        .from('suppliers')
        .insert(missing.map((name) => ({ sucursal_id: sucursalId, name })))
        .select('id, name');
      if (error) throw new Error(`Proveedores: ${error.message}`);
      for (const s of ins ?? []) m.set(norm(s.name), s.id);
    }
    return m;
  }

  async function startImport() {
    setPhase('running');
    setProgress(0);
    setProgressLabel('Preparando categorías y proveedores…');
    const res = { created: 0, updated: 0, skipped: 0, failed: 0, stock: 0 };
    const fails: { row: ParsedRow; reason: string }[] = [];

    let catMap: Map<string, string>;
    let supMap: Map<string, string>;
    try {
      catMap = await resolveCategories();
      supMap = await resolveSuppliers();
    } catch (e) {
      toast.error((e as Error).message);
      setPhase('preview');
      return;
    }

    const catId = (name: string) =>
      name && norm(name) !== norm(SIN_DEPTO) ? catMap.get(norm(name)) ?? null : null;
    const supId = (name: string) => (name ? supMap.get(norm(name)) ?? null : null);

    // Catálogo: news se crean; dups se actualizan según updateMode (skip = no tocar).
    const catalogRows = updateMode === 'skip' ? news : valid;
    res.skipped = updateMode === 'skip' ? dups.length : 0;
    // line → product_id (clave única por fila; el código puede venir vacío/repetido).
    const idByLine = new Map<number, string>();
    for (const r of dups) if (r.existingId) idByLine.set(r.line, r.existingId);

    setProgressLabel('Importando productos…');
    let done = 0;
    const totalCat = catalogRows.length || 1;
    await runPool(catalogRows, 6, async (r) => {
      try {
        if (r.status === 'nuevo') {
          const payload = {
            sucursal_id: sucursalId,
            sku: r.codigo || `IMP-${r.line}-${Date.now().toString(36)}`,
            name: r.name,
            category_id: catId(r.departamento),
            brand_id: null,
            default_supplier_id: supId(r.proveedor),
            base_unit: r.granel ? ('peso' as const) : ('pieza' as const),
            is_weighed: r.granel,
            age_restricted: false,
            tax_rate: r.iva ?? taxRate,
            track_lots: false,
            track_expiry: false,
            min_stock: 0,
            max_stock: null,
            active: r.activo,
            price: toCents(r.precio || 0),
            cost: toCents(r.costo || 0),
            barcode: r.codigo || null,
            initial_stock: 0,
          };
          const parsed = saveProductSchema.safeParse(payload);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
          const { data, error } = await supabase.rpc('upsert_product', { p: parsed.data });
          if (error) throw new Error(error.message);
          const pid = (data as { product_id?: string } | null)?.product_id;
          if (pid) {
            idByLine.set(r.line, pid);
            // mayoreo no lo cubre upsert_product → patch aparte.
            if (r.mayoreo > 0) {
              await supabase.rpc('patch_product', {
                p: { id: pid, sucursal_id: sucursalId, mayoreo: toCents(r.mayoreo) },
              });
            }
          }
          res.created++;
        } else if (r.existingId) {
          // Duplicado: merge NO destructivo. Nunca mandar barcode (no borra códigos)
          // ni tax_rate salvo que el archivo traiga IVA explícito.
          const patch: Record<string, unknown> = {
            id: r.existingId,
            sucursal_id: sucursalId,
            price: toCents(r.precio || 0),
            cost: toCents(r.costo || 0),
          };
          if (r.mayoreo > 0) patch.mayoreo = toCents(r.mayoreo);
          if (updateMode === 'overwrite') {
            patch.name = r.name;
            patch.base_unit = r.granel ? 'peso' : 'pieza';
            patch.is_weighed = r.granel;
            patch.active = r.activo;
            const c = catId(r.departamento);
            if (c) patch.category_id = c;
            const s = supId(r.proveedor);
            if (s) patch.default_supplier_id = s;
            if (r.iva != null) patch.tax_rate = r.iva;
          }
          const parsed = patchProductSchema.safeParse(patch);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
          const { error } = await supabase.rpc('patch_product', { p: parsed.data });
          if (error) throw new Error(error.message);
          res.updated++;
        }
      } catch (e) {
        res.failed++;
        fails.push({ row: r, reason: (e as Error).message });
      } finally {
        done++;
        setProgress(Math.round((done / totalCat) * 80));
      }
    });

    // Existencias: ajuste absoluto idempotente para TODA fila con stock que tenga
    // un producto resuelto (nuevo o existente), sin importar el modo de catálogo.
    if (importStock && withStock.length) {
      setProgressLabel('Ajustando existencias…');
      // Resuelve por línea (clave única). unit_cost fija el costo promedio al subir
      // stock (si no, branch_stock quedaría con avg_cost 0 y valuación/márgenes en 0).
      const items = withStock
        .map((r) => {
          const pid = idByLine.get(r.line);
          return pid && r.existencia != null
            ? {
                product_id: pid,
                target_qty: r.existencia,
                ...(r.costo > 0 ? { unit_cost: toCents(r.costo) } : {}),
              }
            : null;
        })
        .filter((x): x is { product_id: string; target_qty: number } => x !== null);
      const batches = chunk(items, 200);
      let bdone = 0;
      for (const batch of batches) {
        try {
          const payload = {
            sucursal_id: sucursalId,
            reason: `Importación de existencias · ${fileName}`,
            items: batch,
          };
          const parsed = setStockSchema.safeParse(payload);
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
          const { data, error } = await supabase.rpc('set_stock_levels', { p_payload: parsed.data });
          if (error) throw new Error(error.message);
          res.stock += (data as { applied?: number } | null)?.applied ?? 0;
          // Fallos por-ítem que la RPC devuelve dentro de failed[] (no aborta el lote).
          const failedItems =
            (data as { failed?: { product_id: string; error: string }[] } | null)?.failed ?? [];
          for (const fItem of failedItems)
            fails.push({
              row: { line: 0 } as ParsedRow,
              reason: `Existencias ${fItem.product_id}: ${fItem.error}`,
            });
        } catch (e) {
          fails.push({ row: { line: 0 } as ParsedRow, reason: `Existencias: ${(e as Error).message}` });
        }
        bdone++;
        setProgress(80 + Math.round((bdone / batches.length) * 20));
      }
    }

    setProgress(100);
    setResult(res);
    setFailures(fails);
    setPhase('done');
    onDone();
  }

  function downloadTemplate() {
    const cols = FIELDS.map((f) => f.key);
    // Ejemplos alineados al orden de `cols`:
    // codigo,descripcion,precio,costo,mayoreo,existencia,iva,departamento,marca,proveedor,tipo_venta,activo
    const example = [
      ['7501055309986', 'Coca Cola 600ml', '18', '12.50', '16', '24', '16', 'Refrescos', 'Coca Cola', 'Distribuidora SA', 'pieza', '1'],
      ['2000000000017', 'Jamon a granel', '140', '90', '0', '3.5', '0', 'Cremeria', '', '', 'granel', '1'],
    ];
    const csv =
      '\uFEFF' + cols.join(',') + '\r\n' + example.map((e) => e.map(csvCell).join(',')).join('\r\n');
    downloadCsv('plantilla-importacion.csv', csv);
  }

  function downloadErrors() {
    const head = 'linea,codigo,descripcion,motivo';
    const body = failures
      .map((f) => [f.row.line, f.row.codigo ?? '', f.row.name ?? '', f.reason].map(csvCell).join(','))
      .join('\r\n');
    downloadCsv('errores-importacion.csv', '\uFEFF' + head + '\r\n' + body);
  }

  // ── render ──────────────────────────────────────────────────────────────────
  const willImport = updateMode === 'skip' ? news.length : valid.length;

  return (
    <Modal
      title="Importar productos"
      onClose={phase === 'running' ? () => {} : onClose}
      maxWidth={680}
    >
      {phase === 'pick' && (
        <div className="flex flex-col gap-md">
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--text-sm)' }}>
            Sube tu base en <strong>CSV</strong>, <strong>Excel</strong> o{' '}
            <strong>JSON</strong>. Reconozco las columnas automáticamente (código,
            descripción, precio, costo, mayoreo, existencia, IVA, departamento,
            marca, proveedor, tipo); si no, te dejo mapearlas a mano.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            style={dropStyle}
          >
            <Upload size={26} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 600 }}>Elegir archivo (CSV / Excel / JSON)</span>
            <span style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>
              Se procesa en tu navegador; nada se sube hasta que confirmes.
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.json,text/csv,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <button className="btn" onClick={downloadTemplate} style={{ alignSelf: 'flex-start' }}>
            <Download size={14} /> Descargar plantilla CSV
          </button>
        </div>
      )}

      {phase === 'map' && (
        <div className="flex flex-col gap-md">
          <Notice tone="warn">
            <AlertTriangle size={14} /> No reconocí las columnas automáticamente. Asigna cada
            campo a una columna de tu archivo.
          </Notice>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {FIELDS.map((f) => (
              <label key={f.key} style={{ fontSize: 'var(--text-sm)' }}>
                <span style={{ color: 'var(--text-3)' }}>
                  {f.label}
                  {'required' in f && f.required ? ' *' : ''}
                </span>
                <select
                  className="input"
                  value={map[f.key]}
                  onChange={(e) => setMap((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                  style={{ width: '100%' }}
                >
                  <option value={-1}>—</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Columna ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setPhase('pick')}>
              Volver
            </button>
            <button className="btn primary" onClick={() => void confirmMapping()}>
              Continuar
            </button>
          </div>
        </div>
      )}

      {phase === 'preview' && (
        <div className="flex flex-col gap-md">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)' }}>
            <FileUp size={15} /> <strong>{fileName}</strong>
            <button
              className="btn"
              style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 'var(--text-xs)' }}
              onClick={() => setPhase('map')}
            >
              Ajustar columnas
            </button>
          </div>

          <div className="grid grid-4 gap-sm">
            <Stat label="A importar" value={willImport} tone="accent" />
            <Stat label="Nuevos" value={news.length} />
            <Stat label="Duplicados" value={dups.length} tone={dups.length ? 'warn' : undefined} />
            <Stat label="Con error" value={invalid.length} tone={invalid.length ? 'neg' : undefined} />
          </div>

          {map.precio < 0 && (
            <Notice tone="warn">
              <AlertTriangle size={14} /> No hay columna de precio; se importará en 0.
            </Notice>
          )}

          {depts.length > 0 && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>
              Departamentos → categorías: <strong>{depts.join(', ')}</strong>
            </p>
          )}

          {/* IVA global (solo nuevos / sobrescritura sin IVA por fila) */}
          <div className="flex flex-col gap-sm">
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>IVA por producto (nuevos)</label>
            <div className="flex gap-sm">
              {[
                { v: 0, l: '0% (alimentos)' },
                { v: 0.16, l: '16%' },
                { v: 0.08, l: '8% (frontera)' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  className={'filter-chip' + (taxRate === o.v ? ' active' : '')}
                  onClick={() => setTaxRate(o.v)}
                >
                  {o.l}
                </button>
              ))}
              {map.iva >= 0 && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', alignSelf: 'center' }}>
                  (las filas con columna IVA usan su propia tasa)
                </span>
              )}
            </div>
          </div>

          {/* Existencias */}
          {withStock.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)' }}>
              <input type="checkbox" checked={importStock} onChange={(e) => setImportStock(e.target.checked)} />
              Ajustar existencias de {withStock.length} productos al valor del archivo (idempotente).
            </label>
          )}

          {/* Estrategia para duplicados */}
          {dups.length > 0 && (
            <div className="flex flex-col gap-sm" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                {dups.length} productos ya existen (por código). ¿Qué hago con ellos?
              </span>
              {[
                { v: 'skip', l: 'Omitirlos (no tocar nada)', hint: 'Mantiene tus datos actuales intactos.' },
                { v: 'price', l: 'Actualizar solo precio/costo', hint: 'Conserva categoría, IVA, proveedor y códigos.' },
                { v: 'overwrite', l: 'Sobrescribir con los datos del archivo', hint: 'Reemplaza nombre, categoría y precios (no borra códigos ni IVA salvo que el archivo lo traiga).' },
              ].map((o) => (
                <label key={o.v} style={{ display: 'flex', gap: 8, fontSize: 'var(--text-sm)', alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name="updmode"
                    checked={updateMode === o.v}
                    onChange={() => setUpdateMode(o.v as UpdateMode)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    {o.l}
                    <br />
                    <span style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <PreviewTable rows={valid.slice(0, 8)} />
          {invalid.length > 0 && (
            <Notice tone="neg">
              <AlertTriangle size={14} /> {invalid.length} filas se omitirán por error (p. ej. sin descripción).
            </Notice>
          )}

          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setPhase('pick')}>
              Cambiar archivo
            </button>
            <button className="btn primary" disabled={willImport === 0} onClick={() => void startImport()}>
              Importar {willImport} productos
            </button>
          </div>
        </div>
      )}

      {phase === 'running' && (
        <div className="flex flex-col gap-md" style={{ alignItems: 'center', padding: '12px 0' }}>
          <Loader2 size={28} className="spin" style={{ color: 'var(--accent)' }} />
          <strong>{progressLabel} {progress}%</strong>
          <div style={{ width: '100%', height: 8, background: 'var(--surface-2)', borderRadius: 99 }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 99, transition: 'width .2s' }} />
          </div>
          <span style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>No cierres esta ventana.</span>
        </div>
      )}

      {phase === 'done' && (
        <div className="flex flex-col gap-md">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={24} style={{ color: 'var(--pos)' }} />
            <strong style={{ fontSize: 'var(--text-lg)' }}>Importación terminada</strong>
          </div>
          <div className="grid grid-4 gap-sm">
            <Stat label="Creados" value={result.created} tone="accent" />
            <Stat label="Actualizados" value={result.updated} />
            <Stat label="Omitidos" value={result.skipped} />
            <Stat label="Fallidos" value={result.failed} tone={result.failed ? 'neg' : undefined} />
          </div>
          {result.stock > 0 && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}>
              Existencias ajustadas en {result.stock} productos.
            </p>
          )}
          {failures.length > 0 && (
            <>
              <Notice tone="neg">
                <AlertTriangle size={14} /> {failures.length} incidencias durante la importación.
              </Notice>
              <button className="btn" onClick={downloadErrors} style={{ alignSelf: 'flex-start' }}>
                <Download size={14} /> Descargar incidencias (CSV)
              </button>
            </>
          )}
          <div className="flex gap-sm" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={onClose}>
              Listo
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── estilos / subcomponentes ──────────────────────────────────────────────────
const dropStyle: React.CSSProperties = {
  border: '1.5px dashed var(--border)',
  borderRadius: 12,
  padding: '28px 16px',
  background: 'var(--surface-2)',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'accent' | 'warn' | 'neg' }) {
  const color =
    tone === 'accent' ? 'var(--accent)' : tone === 'warn' ? 'var(--warn)' : tone === 'neg' ? 'var(--neg)' : 'var(--text-1)';
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>{label}</div>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'neg'; children: ReactNode }) {
  const bg = tone === 'neg' ? 'rgba(220,38,38,.08)' : 'rgba(217,119,6,.08)';
  const fg = tone === 'neg' ? 'var(--neg)' : 'var(--warn)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: bg, color: fg, borderRadius: 8, padding: '8px 12px', fontSize: 'var(--text-sm)' }}>
      {children}
    </div>
  );
}

function PreviewTable({ rows }: { rows: ParsedRow[] }) {
  if (!rows.length) return null;
  const anyStock = rows.some((r) => r.existencia != null);
  const anyMay = rows.some((r) => r.mayoreo > 0);
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table className="table" style={{ fontSize: 'var(--text-xs)', width: '100%' }}>
        <thead>
          <tr>
            <th>Código</th>
            <th>Descripción</th>
            <th>Tipo</th>
            <th style={{ textAlign: 'right' }}>Costo</th>
            <th style={{ textAlign: 'right' }}>Precio</th>
            {anyMay && <th style={{ textAlign: 'right' }}>Mayoreo</th>}
            {anyStock && <th style={{ textAlign: 'right' }}>Exist.</th>}
            <th>Depto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.line}>
              <td>{r.codigo || '—'}</td>
              <td>{r.name}</td>
              <td>{r.granel ? 'Granel' : 'Pieza'}</td>
              <td style={{ textAlign: 'right' }}>${r.costo.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>${r.precio.toFixed(2)}</td>
              {anyMay && <td style={{ textAlign: 'right' }}>{r.mayoreo > 0 ? `$${r.mayoreo.toFixed(2)}` : '—'}</td>}
              {anyStock && <td style={{ textAlign: 'right' }}>{r.existencia ?? '—'}</td>}
              <td>{r.departamento || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
