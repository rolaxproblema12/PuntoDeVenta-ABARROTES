import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Package,
  Pencil,
  Percent,
  Plus,
  Search,
} from 'lucide-react';
import {
  formatMoney,
  fromCents,
  toCents,
  saveProductSchema,
  type BaseUnit,
} from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { useActiveSucursal } from '@/lib/useActiveSucursal';
import { PageHeader, Modal, EmptyState, Kpi, Badge, type BadgeTone } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { stamp, type ExportDataset } from '@/lib/export';
import { CategoriesModal } from './CategoriesModal';

interface Row {
  id: string;
  sku: string;
  name: string;
  base_unit: BaseUnit;
  tax_rate: number;
  active: boolean;
  category_id: string | null;
  brand_id: string | null;
  default_supplier_id: string | null;
  is_weighed: boolean;
  age_restricted: boolean;
  track_lots: boolean;
  track_expiry: boolean;
  min_stock: number;
  max_stock: number | null;
  product_prices: { price: number; cost: number; price_list_id: string }[];
  product_barcodes: { barcode: string }[];
}

interface FormState {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  category_id: string | null;
  brand_id: string | null;
  default_supplier_id: string | null;
  base_unit: BaseUnit;
  tax_rate: number;
  price: string; // pesos
  cost: string; // pesos
  min_stock: string;
  max_stock: string;
  initial_stock: string;
  is_weighed: boolean;
  age_restricted: boolean;
  track_lots: boolean;
  track_expiry: boolean;
  active: boolean;
}

const empty: FormState = {
  name: '',
  sku: '',
  barcode: '',
  category_id: null,
  brand_id: null,
  default_supplier_id: null,
  base_unit: 'pieza',
  tax_rate: 0.16,
  price: '',
  cost: '',
  min_stock: '0',
  max_stock: '',
  initial_stock: '0',
  is_weighed: false,
  age_restricted: false,
  track_lots: false,
  track_expiry: false,
  active: true,
};

/** Traduce errores del servidor a algo legible para el cajero. */
function friendlyError(msg: string): string {
  if (msg.includes('BARCODE_TAKEN'))
    return 'Ese código de barras ya está en uso en esta sucursal.';
  if (
    msg.includes('products_sucursal_id_sku_key') ||
    (msg.toLowerCase().includes('duplicate') && msg.toLowerCase().includes('sku'))
  )
    return 'El SKU ya existe en esta sucursal.';
  return msg;
}

/** Margen porcentual de una fila (price/cost en centavos). */
function rowMargin(p: Row): number {
  const price = p.product_prices?.[0]?.price ?? 0;
  const cost = p.product_prices?.[0]?.cost ?? 0;
  return price > 0 ? ((price - cost) / price) * 100 : 0;
}

/** Tono semántico del margen para el Badge de tabla. */
function marginTone(margin: number): BadgeTone {
  if (margin > 30) return 'pos';
  if (margin >= 20) return 'default';
  return 'warn';
}

/** Subtítulo de sección dentro del modal (mayúsculas tenues). */
function FormSection({ label, first }: { label: string; first?: boolean }) {
  return (
    <div
      className="text-xs fw-600"
      style={{
        color: 'var(--text-3)',
        textTransform: 'uppercase',
        letterSpacing: '.06em',
        borderTop: first ? undefined : '1px solid var(--border)',
        paddingTop: first ? undefined : 12,
      }}
    >
      {label}
    </div>
  );
}

export default function ProductsPage() {
  const sucursalId = useActiveSucursal();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [showAdv, setShowAdv] = useState(false);
  const [addingCat, setAddingCat] = useState('');
  const [showCats, setShowCats] = useState(false);

  const { data: suc } = useQuery({
    queryKey: ['suc-name', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('sucursales')
        .select('name, code')
        .eq('id', sucursalId!)
        .maybeSingle();
      return data;
    },
  });
  const business = suc ? `${suc.name} (${suc.code})` : 'POS';

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data } = await supabase
        .from('categories')
        .select('id, name')
        .eq('sucursal_id', sucursalId!)
        .order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const catName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? '';

  const { data: brands = [] } = useQuery({
    queryKey: ['brands'],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data } = await supabase.from('brands').select('id, name').order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data } = await supabase
        .from('suppliers')
        .select('id, name')
        .eq('sucursal_id', sucursalId!)
        .eq('active', true)
        .order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id,sku,name,base_unit,tax_rate,active,category_id,brand_id,default_supplier_id,is_weighed,age_restricted,track_lots,track_expiry,min_stock,max_stock,product_prices(price,cost,price_list_id),product_barcodes(barcode)',
        )
        .eq('sucursal_id', sucursalId!)
        .order('name')
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      if (!sucursalId) throw new Error('Sin sucursal');
      const payload = {
        ...(f.id ? { id: f.id } : {}),
        sucursal_id: sucursalId,
        sku: f.sku.trim() || `SKU${Date.now()}`,
        name: f.name.trim(),
        category_id: f.category_id,
        brand_id: f.brand_id,
        default_supplier_id: f.default_supplier_id,
        base_unit: f.base_unit,
        tax_rate: f.tax_rate,
        is_weighed: f.is_weighed,
        age_restricted: f.age_restricted,
        track_lots: f.track_lots,
        track_expiry: f.track_expiry,
        min_stock: Number(f.min_stock) || 0,
        max_stock:
          f.max_stock.trim() && Number(f.max_stock) > 0
            ? Number(f.max_stock)
            : null,
        active: f.active,
        price: toCents(Number(f.price) || 0),
        cost: toCents(Number(f.cost) || 0),
        barcode: f.barcode.trim() || null,
        initial_stock: f.id ? 0 : Number(f.initial_stock) || 0,
      };
      const parsed = saveProductSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      }
      return api('/catalog/products', { method: 'POST', body: parsed.data });
    },
    onSuccess: () => {
      toast.success('Producto guardado');
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (e) => toast.error(friendlyError((e as Error).message)),
  });

  // ── KPIs (cliente) ─────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = products.length;
    const activos = products.filter((p) => p.active).length;
    const inactivos = total - activos;
    const conPrecio = products.filter((p) => (p.product_prices?.[0]?.price ?? 0) > 0);
    const avgMargin = conPrecio.length
      ? conPrecio.reduce((a, p) => a + rowMargin(p), 0) / conPrecio.length
      : 0;
    return { total, activos, inactivos, avgMargin };
  }, [products]);

  // ── Conteo por categoría para las chips ─────────────────────────────────────
  const countByCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      if (!p.category_id) continue;
      map.set(p.category_id, (map.get(p.category_id) ?? 0) + 1);
    }
    return map;
  }, [products]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return products.filter((p) => {
      if (onlyActive && !p.active) return false;
      if (catFilter && p.category_id !== catFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.product_barcodes?.some((b) => b.barcode.includes(q))
      );
    });
  }, [term, products, catFilter, onlyActive]);

  function openEdit(p: Row) {
    const pp = p.product_prices?.[0];
    setShowAdv(false);
    setAddingCat('');
    setForm({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.product_barcodes?.[0]?.barcode ?? '',
      category_id: p.category_id,
      brand_id: p.brand_id ?? null,
      default_supplier_id: p.default_supplier_id ?? null,
      base_unit: p.base_unit,
      tax_rate: p.tax_rate,
      price: pp ? String(fromCents(pp.price)) : '',
      cost: pp ? String(fromCents(pp.cost)) : '',
      min_stock: String(p.min_stock ?? 0),
      max_stock: p.max_stock != null ? String(p.max_stock) : '',
      initial_stock: '0',
      is_weighed: p.is_weighed ?? false,
      age_restricted: p.age_restricted ?? false,
      track_lots: p.track_lots ?? false,
      track_expiry: p.track_expiry ?? false,
      active: p.active,
    });
  }

  function openNew() {
    setShowAdv(false);
    setAddingCat('');
    setForm({ ...empty });
  }

  async function quickAddCategory(name: string) {
    const n = name.trim();
    if (!n || !sucursalId) return;
    const { data, error } = await supabase
      .from('categories')
      .insert({ sucursal_id: sucursalId, name: n })
      .select('id')
      .single();
    if (error) return toast.error(error.message);
    await qc.invalidateQueries({ queryKey: ['categories'] });
    setForm((f) => (f ? { ...f, category_id: data.id } : f));
    setAddingCat('');
    toast.success('Categoría creada');
  }

  const catalogDataset = (): ExportDataset => ({
    title: 'Catálogo de productos',
    filename: `catalogo-${stamp()}`,
    meta: [
      { label: 'Negocio', value: business },
      { label: 'Generado', value: new Date().toLocaleString('es-MX') },
    ],
    rows: products,
    columns: [
      { header: 'Producto', value: (p: Row) => p.name },
      { header: 'SKU', value: (p: Row) => p.sku },
      { header: 'Categoría', value: (p: Row) => catName(p.category_id) },
      {
        header: 'Costo',
        value: (p: Row) => p.product_prices?.[0]?.cost ?? 0,
        money: true,
      },
      {
        header: 'Precio',
        value: (p: Row) => p.product_prices?.[0]?.price ?? 0,
        money: true,
      },
      { header: 'Activo', value: (p: Row) => (p.active ? 'Sí' : 'No') },
    ],
  });

  const isNew = form ? !form.id : true;

  // Preview en vivo del margen del formulario (price/cost en pesos).
  const formPrice = form ? Number(form.price) || 0 : 0;
  const formCost = form ? Number(form.cost) || 0 : 0;
  const formMargin = formPrice > 0 ? ((formPrice - formCost) / formPrice) * 100 : 0;
  const showMarginPreview = !!form && formPrice > 0 && formCost > 0;

  return (
    <div className="page">
      <PageHeader
        title="Catálogo de productos"
        subtitle={`${products.length} productos · catálogo de la sucursal`}
        actions={
          <div className="flex gap-sm items-center">
            <ExportMenu
              size="sm"
              label="Exportar"
              getDatasets={catalogDataset}
              business={business}
              disabled={products.length === 0}
            />
            <button onClick={() => setShowCats(true)} className="btn">
              <FolderTree size={14} /> Categorías
            </button>
            <button onClick={openNew} className="btn primary">
              <Plus size={13} /> Nuevo producto
            </button>
          </div>
        }
      />

      <div className="grid grid-4 mb-lg">
        <Kpi label="Productos" value={String(kpis.total)} icon={Package} />
        <Kpi
          label="Activos"
          value={String(kpis.activos)}
          icon={CheckCircle2}
          hint={kpis.inactivos > 0 ? `${kpis.inactivos} inactivos` : undefined}
        />
        <Kpi
          label="Margen prom."
          value={`${kpis.avgMargin.toFixed(1)}%`}
          icon={Percent}
        />
        <Kpi label="Categorías" value={String(categories.length)} icon={FolderTree} />
      </div>

      <div className="filters">
        <div className="search-input" style={{ minWidth: 320 }}>
          <Search size={13} />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por nombre, SKU o código…"
          />
        </div>
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--text-3)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {filtered.length} resultados
        </span>
      </div>

      <div className="filters">
        <button
          type="button"
          className={'filter-chip' + (catFilter === null ? ' active' : '')}
          onClick={() => setCatFilter(null)}
          aria-pressed={catFilter === null}
        >
          Todas
          <span className="chip-count">{products.length}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={'filter-chip' + (catFilter === c.id ? ' active' : '')}
            onClick={() => setCatFilter((cur) => (cur === c.id ? null : c.id))}
            aria-pressed={catFilter === c.id}
          >
            {c.name}
            <span className="chip-count">{countByCat.get(c.id) ?? 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={'filter-chip solid' + (onlyActive ? ' active' : '')}
          onClick={() => setOnlyActive((v) => !v)}
          aria-pressed={onlyActive}
          style={{ marginLeft: 'auto' }}
        >
          <CheckCircle2 size={13} />
          Solo activos
        </button>
      </div>

      {isLoading ? (
        <p className="text-3">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Package}
            title="Sin productos"
            hint={
              term.trim() || catFilter || onlyActive
                ? 'Ningún producto coincide con los filtros.'
                : 'Crea el primero con “Nuevo producto”.'
            }
            action={
              <button className="btn accent" onClick={openNew}>
                <Plus size={13} /> Nuevo producto
              </button>
            }
          />
        </div>
      ) : (
        <div className="tbl-card">
          <table className="tbl">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>SKU</th>
                <th style={{ textAlign: 'right' }}>Costo</th>
                <th style={{ textAlign: 'right' }}>Precio</th>
                <th style={{ textAlign: 'right' }}>Margen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const price = p.product_prices?.[0]?.price ?? 0;
                const cost = p.product_prices?.[0]?.cost ?? 0;
                const margen = rowMargin(p);
                return (
                  <tr key={p.id} className={p.active ? undefined : 'row-muted'}>
                    <td data-label="Producto">
                      <div className="flex items-center" style={{ gap: 10 }}>
                        <div className="thumb">
                          {p.name
                            .split(' ')
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')}
                        </div>
                        <div>
                          <div
                            className="fw-500"
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            {p.name}
                            {!p.active && <span className="badge neg">inactivo</span>}
                          </div>
                          <div className="text-3 text-xs">{p.base_unit}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Categoría" className="muted text-sm">{catName(p.category_id) || '—'}</td>
                    <td data-label="SKU" className="mono text-xs muted">{p.sku}</td>
                    <td data-label="Costo" className="num tnum text-2">{formatMoney(cost)}</td>
                    <td data-label="Precio" className="num tnum fw-600">{formatMoney(price)}</td>
                    <td data-label="Margen" className="num">
                      {price > 0 ? (
                        <Badge tone={marginTone(margen)}>{margen.toFixed(1)}%</Badge>
                      ) : (
                        <span className="text-3">—</span>
                      )}
                    </td>
                    <td data-label="" style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => openEdit(p)}
                        className="btn ghost sm"
                        aria-label={`Editar ${p.name}`}
                        title="Editar producto"
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCats && (
        <CategoriesModal sucursalId={sucursalId} onClose={() => setShowCats(false)} />
      )}

      {form && (
        <Modal
          title={`${form.id ? 'Editar' : 'Nuevo'} producto`}
          onClose={() => setForm(null)}
          footer={
            <button
              disabled={save.isPending || !form.name.trim()}
              onClick={() => save.mutate(form)}
              className="btn accent"
              style={{ width: '100%', height: 38, justifyContent: 'center' }}
            >
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          }
        >
          {/* ── Datos básicos ── */}
          <FormSection label="Datos básicos" first />
          <div>
            <label className="label">Nombre</label>
            <input
              autoFocus
              className="field"
              placeholder="Nombre del producto"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-2" style={{ gap: 10 }}>
            <div>
              <label className="label">SKU (opcional)</label>
              <input
                className="field"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Código de barras</label>
              <input
                className="field"
                inputMode="numeric"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">Categoría</label>
            {addingCat === '' ? (
              <div className="flex gap-sm">
                <select
                  className="field"
                  value={form.category_id ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, category_id: e.target.value || null })
                  }
                >
                  <option value="">— Sin categoría —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAddingCat(' ')}
                  title="Nueva categoría"
                  aria-label="Nueva categoría"
                >
                  <Plus size={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-sm">
                <input
                  className="field"
                  autoFocus
                  placeholder="Nombre de la categoría"
                  value={addingCat.trim() === '' ? '' : addingCat}
                  onChange={(e) => setAddingCat(e.target.value || ' ')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void quickAddCategory(addingCat);
                    if (e.key === 'Escape') setAddingCat('');
                  }}
                />
                <button
                  type="button"
                  className="btn accent"
                  onClick={() => void quickAddCategory(addingCat)}
                  disabled={!addingCat.trim()}
                >
                  Crear
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAddingCat('')}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>

          {/* ── Precio ── */}
          <FormSection label="Precio" />

          <div className="grid grid-2" style={{ gap: 10 }}>
            <div>
              <label className="label">Precio venta ($)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                className="field"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Costo ($)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                className="field"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </div>
          </div>

          {showMarginPreview && (
            <div
              className="glass-strong flex items-center justify-between text-sm"
              style={{ padding: '8px 12px' }}
            >
              <span className="text-2">Margen estimado</span>
              <div className="flex items-center gap-sm">
                <span className="text-2 text-xs tnum">
                  Ganancia {formatMoney(toCents(formPrice - formCost))}
                </span>
                <Badge tone={marginTone(formMargin)}>{formMargin.toFixed(1)}%</Badge>
              </div>
            </div>
          )}

          {/* ── Inventario ── */}
          <FormSection label="Inventario" />

          <div className="grid grid-2" style={{ gap: 10 }}>
            <div>
              <label className="label">Unidad</label>
              <select
                className="field"
                value={form.base_unit}
                onChange={(e) =>
                  setForm({ ...form, base_unit: e.target.value as BaseUnit })
                }
              >
                <option value="pieza">Pieza</option>
                <option value="caja">Caja</option>
                <option value="paquete">Paquete</option>
                <option value="peso">Peso</option>
              </select>
            </div>
            {isNew ? (
              <div>
                <label className="label">Existencia inicial</label>
                <input
                  type="number"
                  min={0}
                  step={0.001}
                  className="field"
                  value={form.initial_stock}
                  onChange={(e) =>
                    setForm({ ...form, initial_stock: e.target.value })
                  }
                />
              </div>
            ) : (
              <label
                className="flex items-center gap-sm text-sm"
                style={{ height: 34, marginTop: 22 }}
              >
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Activo
              </label>
            )}
          </div>

          {isNew && (
            <label className="flex items-center gap-sm text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Activo
            </label>
          )}

          {/* ── Opciones avanzadas (colapsable) ── */}
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setShowAdv((v) => !v)}
            style={{ alignSelf: 'flex-start', paddingLeft: 0 }}
          >
            {showAdv ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Opciones avanzadas
          </button>

          {showAdv && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                borderTop: '1px solid var(--border)',
                paddingTop: 12,
              }}
            >
              <div className="grid grid-2" style={{ gap: 10 }}>
                <div>
                  <label className="label">Marca</label>
                  <select
                    className="field"
                    value={form.brand_id ?? ''}
                    onChange={(e) =>
                      setForm({ ...form, brand_id: e.target.value || null })
                    }
                  >
                    <option value="">— Sin marca —</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Proveedor por defecto</label>
                  <select
                    className="field"
                    value={form.default_supplier_id ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        default_supplier_id: e.target.value || null,
                      })
                    }
                  >
                    <option value="">— Ninguno —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-2" style={{ gap: 10 }}>
                <div>
                  <label className="label">Stock mínimo</label>
                  <input
                    type="number"
                    min={0}
                    className="field"
                    value={form.min_stock}
                    onChange={(e) =>
                      setForm({ ...form, min_stock: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Stock máximo (opcional)</label>
                  <input
                    type="number"
                    min={0}
                    className="field"
                    value={form.max_stock}
                    onChange={(e) =>
                      setForm({ ...form, max_stock: e.target.value })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="label">Impuesto (IVA)</label>
                <select
                  className="field"
                  value={String(form.tax_rate)}
                  onChange={(e) =>
                    setForm({ ...form, tax_rate: Number(e.target.value) })
                  }
                >
                  <option value="0.16">16%</option>
                  <option value="0.08">8% (frontera)</option>
                  <option value="0">0% (exento)</option>
                </select>
              </div>

              <div
                className="grid grid-2"
                style={{ gap: 8, fontSize: 'var(--text-sm)' }}
              >
                <label className="flex items-center gap-sm">
                  <input
                    type="checkbox"
                    checked={form.track_lots}
                    onChange={(e) =>
                      setForm({ ...form, track_lots: e.target.checked })
                    }
                  />
                  Maneja lotes
                </label>
                <label className="flex items-center gap-sm">
                  <input
                    type="checkbox"
                    checked={form.track_expiry}
                    onChange={(e) =>
                      setForm({ ...form, track_expiry: e.target.checked })
                    }
                  />
                  Controla caducidad
                </label>
                <label className="flex items-center gap-sm">
                  <input
                    type="checkbox"
                    checked={form.is_weighed}
                    onChange={(e) =>
                      setForm({ ...form, is_weighed: e.target.checked })
                    }
                  />
                  Se vende por peso
                </label>
                <label className="flex items-center gap-sm">
                  <input
                    type="checkbox"
                    checked={form.age_restricted}
                    onChange={(e) =>
                      setForm({ ...form, age_restricted: e.target.checked })
                    }
                  />
                  Restringido por edad
                </label>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
