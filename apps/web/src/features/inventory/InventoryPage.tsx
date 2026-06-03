import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDownUp,
  List,
  Package,
  PackagePlus,
  PackageX,
  Search,
  Wallet,
} from 'lucide-react';
import {
  formatMoney,
  toCents,
  type StockMovementInput,
  type StockMovementResult,
} from '@abarrotes/shared';
import { useActiveSucursal } from '@/lib/useActiveSucursal';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import {
  PageHeader,
  Modal,
  Badge,
  EmptyState,
  Kpi,
  MiniBar,
  type BadgeTone,
  type MiniBarTone,
} from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { stamp, type ExportDataset } from '@/lib/export';

interface StockRow {
  product_id: string;
  stock: number;
  avg_cost: number;
  products: { name: string; sku: string; min_stock: number } | null;
}
type MovKind = 'entrada' | 'salida' | 'ajuste' | 'merma';
type StatusFilter = 'todos' | 'ok' | 'bajo' | 'agotado';

interface MovState {
  productId: string;
  name: string;
  currentStock: number;
  kind: MovKind;
  qty: string;
  target: string;
  cost: string;
  lot: string;
  expiry: string;
  reason: string;
  pin: string;
}

const KIND_LABEL: Record<MovKind, string> = {
  entrada: 'Entrada (+)',
  ajuste: 'Ajuste a conteo',
  salida: 'Salida (−)',
  merma: 'Merma (−)',
};

const KIND_TONE: Record<MovKind, BadgeTone> = {
  entrada: 'pos',
  salida: 'neg',
  merma: 'neg',
  ajuste: 'info',
};

const KIND_KARDEX_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  merma: 'Merma',
};

function initials(name: string): string {
  return (
    name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}

export default function InventoryPage() {
  const sucursalId = useActiveSucursal();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [mov, setMov] = useState<MovState | null>(null);
  const [picking, setPicking] = useState(false);
  const [kardexFor, setKardexFor] = useState<string | null>(null);

  const { data: stock = [], isLoading } = useQuery({
    queryKey: ['stock', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<StockRow[]> => {
      const { data, error } = await supabase
        .from('branch_stock')
        .select('product_id, stock, avg_cost, products(name, sku, min_stock)')
        .eq('sucursal_id', sucursalId!)
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as StockRow[];
    },
  });

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

  const { data: kardex = [] } = useQuery({
    queryKey: ['kardex', kardexFor, sucursalId],
    enabled: !!kardexFor,
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory_movements')
        .select('created_at, kind, quantity, reason:ref_type')
        .eq('product_id', kardexFor!)
        .eq('sucursal_id', sucursalId!)
        .order('created_at', { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const applyMov = useMutation({
    mutationFn: async (m: MovState): Promise<StockMovementResult> => {
      const base = { sucursal_id: sucursalId!, product_id: m.productId };
      if (m.kind === 'entrada') {
        const q = Number(m.qty);
        if (!q || q <= 0) throw new Error('Cantidad inválida');
        const body: StockMovementInput = {
          ...base,
          kind: 'entrada',
          quantity: q,
          unit_cost: m.cost.trim() ? toCents(Number(m.cost)) : undefined,
          lot_code: m.lot.trim() || null,
          expiry_date: m.expiry || null,
        };
        return api<StockMovementResult>('/inventory/entry', {
          method: 'POST',
          body,
        });
      } else if (m.kind === 'ajuste') {
        if (m.target.trim() === '' || Number(m.target) < 0)
          throw new Error('Stock contado inválido');
        if (!m.reason.trim()) throw new Error('El ajuste requiere motivo');
        if (!m.pin.trim()) throw new Error('PIN requerido');
        const body: StockMovementInput = {
          ...base,
          kind: 'ajuste',
          target_qty: Number(m.target),
          reason: m.reason.trim(),
        };
        return api<StockMovementResult>('/inventory/adjust', {
          method: 'POST',
          body,
          pin: m.pin.trim(),
        });
      } else {
        const q = Number(m.qty);
        if (!q || q <= 0) throw new Error('Cantidad inválida');
        if (m.kind === 'merma' && !m.reason.trim())
          throw new Error('La merma requiere motivo');
        if (!m.pin.trim()) throw new Error('PIN requerido');
        const body: StockMovementInput = {
          ...base,
          kind: m.kind,
          quantity: q,
          reason: m.reason.trim() || undefined,
        };
        return api<StockMovementResult>('/inventory/adjust', {
          method: 'POST',
          body,
          pin: m.pin.trim(),
        });
      }
    },
    onSuccess: (res) => {
      if (res?.noop) toast('Sin cambios: el conteo ya coincide con el sistema.');
      else toast.success('Movimiento aplicado');
      setMov(null);
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['kardex'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Estado de existencias por fila (reutilizado en filtros, KPIs y tabla).
  function rowStatus(s: StockRow): Exclude<StatusFilter, 'todos'> {
    const min = s.products?.min_stock ?? 0;
    if (s.stock <= 0) return 'agotado';
    if (s.stock <= min) return 'bajo';
    return 'ok';
  }

  const withProduct = useMemo(() => stock.filter((s) => s.products), [stock]);

  const counts = useMemo(() => {
    let ok = 0;
    let bajo = 0;
    let agotado = 0;
    for (const s of withProduct) {
      const st = rowStatus(s);
      if (st === 'agotado') agotado += 1;
      else if (st === 'bajo') bajo += 1;
      else ok += 1;
    }
    return { todos: withProduct.length, ok, bajo, agotado };
  }, [withProduct]);

  const filtered = useMemo(() => {
    const term2 = term.trim().toLowerCase();
    return withProduct.filter((s) => {
      if (statusFilter !== 'todos' && rowStatus(s) !== statusFilter) return false;
      if (!term2) return true;
      return (
        s.products!.name.toLowerCase().includes(term2) ||
        s.products!.sku.toLowerCase().includes(term2)
      );
    });
  }, [term, statusFilter, withProduct]);

  // 'low' incluye agotados (stock <= mínimo); 'agotados' es el subconjunto con stock <= 0.
  const lowCount = stock.filter(
    (s) => s.products && s.stock <= (s.products.min_stock ?? 0),
  ).length;
  const outCount = stock.filter((s) => s.products && s.stock <= 0).length;
  const invValue = stock.reduce(
    (a, s) => a + Math.round(s.stock * (s.avg_cost ?? 0)),
    0,
  );

  function openMov(row: StockRow, kind: MovKind = 'entrada') {
    setMov({
      productId: row.product_id,
      name: row.products?.name ?? 'Producto',
      currentStock: row.stock,
      kind,
      qty: '',
      target: String(row.stock),
      cost: '',
      lot: '',
      expiry: '',
      reason: '',
      pin: '',
    });
  }

  const needsPin = mov ? mov.kind !== 'entrada' : false;

  // Preview del stock resultante según el tipo de movimiento.
  const movPreview = useMemo(() => {
    if (!mov) return null;
    if (mov.kind === 'ajuste') {
      if (mov.target.trim() === '') return null;
      const next = Number(mov.target);
      if (Number.isNaN(next)) return null;
      return { next, delta: next - mov.currentStock };
    }
    if (mov.qty.trim() === '') return null;
    const q = Number(mov.qty);
    if (Number.isNaN(q)) return null;
    const delta = mov.kind === 'entrada' ? q : -q;
    return { next: mov.currentStock + delta, delta };
  }, [mov]);

  const kardexName =
    stock.find((s) => s.product_id === kardexFor)?.products?.name ?? 'producto';

  const existenciasDataset = (): ExportDataset => ({
    title: 'Existencias',
    filename: `existencias-${stamp()}`,
    meta: [
      { label: 'Negocio', value: business },
      { label: 'Generado', value: new Date().toLocaleString('es-MX') },
    ],
    totals: true,
    rows: stock.filter((s) => s.products),
    columns: [
      { header: 'Producto', value: (r: StockRow) => r.products?.name ?? '' },
      { header: 'SKU', value: (r: StockRow) => r.products?.sku ?? '' },
      { header: 'Stock', value: (r: StockRow) => r.stock, number: true },
      {
        header: 'Mínimo',
        value: (r: StockRow) => r.products?.min_stock ?? 0,
        number: true,
      },
      { header: 'Costo prom.', value: (r: StockRow) => r.avg_cost ?? 0, money: true },
      {
        header: 'Valor',
        value: (r: StockRow) => Math.round(r.stock * (r.avg_cost ?? 0)),
        money: true,
      },
    ],
  });

  const kardexDataset = (): ExportDataset => ({
    title: `Kardex — ${kardexName}`,
    filename: `kardex-${kardexName}-${stamp()}`.replace(/\s+/g, '_'),
    meta: [
      { label: 'Negocio', value: business },
      { label: 'Producto', value: kardexName },
      { label: 'Generado', value: new Date().toLocaleString('es-MX') },
    ],
    rows: kardex as any[],
    columns: [
      {
        header: 'Fecha',
        value: (k: any) => new Date(k.created_at).toLocaleString('es-MX'),
      },
      { header: 'Tipo', value: (k: any) => k.kind },
      { header: 'Cantidad', value: (k: any) => Number(k.quantity ?? 0), number: true },
      { header: 'Motivo', value: (k: any) => k.reason ?? '' },
    ],
  });

  const chips: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'todos', label: 'Todos', count: counts.todos },
    { key: 'ok', label: 'OK', count: counts.ok },
    { key: 'bajo', label: 'Bajo stock', count: counts.bajo },
    { key: 'agotado', label: 'Agotados', count: counts.agotado },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Inventario"
        subtitle={`${withProduct.length} productos en existencia`}
        actions={
          <div className="flex gap-sm items-center">
            {lowCount > 0 && (
              <Badge tone="warn" dot>
                <AlertTriangle size={13} /> {lowCount} con bajo stock
              </Badge>
            )}
            <ExportMenu
              size="sm"
              label="Exportar"
              getDatasets={existenciasDataset}
              business={business}
              disabled={stock.length === 0}
            />
            <button onClick={() => setPicking(true)} className="btn accent sm">
              <PackagePlus size={14} /> Nueva entrada
            </button>
          </div>
        }
      />

      <div className="grid grid-4 mb-lg">
        <Kpi label="Productos" value={withProduct.length} icon={Package} />
        <Kpi
          label="Bajo stock"
          value={
            <span style={{ color: lowCount > 0 ? 'var(--warn)' : undefined }}>
              {lowCount}
            </span>
          }
          icon={AlertTriangle}
        />
        <Kpi
          label="Agotados"
          value={
            <span style={{ color: outCount > 0 ? 'var(--neg)' : undefined }}>
              {outCount}
            </span>
          }
          icon={PackageX}
        />
        <Kpi label="Valor de inventario" value={formatMoney(invValue)} icon={Wallet} />
      </div>

      <div className="filters">
        <div className="search-input" style={{ minWidth: 280 }}>
          <Search size={13} />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar producto…"
          />
        </div>
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={
              'filter-chip solid' + (statusFilter === c.key ? ' active' : '')
            }
            onClick={() => setStatusFilter(c.key)}
            aria-pressed={statusFilter === c.key}
          >
            {c.label}
            <span className="chip-count">{c.count}</span>
          </button>
        ))}
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

      {isLoading ? (
        <p className="text-3">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Package}
            title="Sin productos"
            hint="No hay existencias que coincidan."
          />
        </div>
      ) : (
        <div className="tbl-card">
          <table className="tbl">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Stock</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Mínimo</th>
                <th style={{ textAlign: 'right' }}>Costo prom.</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const min = s.products!.min_stock ?? 0;
                const low = s.stock <= min;
                const out = s.stock <= 0;
                const tone: MiniBarTone = out ? 'neg' : low ? 'warn' : 'pos';
                const badgeTone: BadgeTone = out ? 'neg' : low ? 'warn' : 'pos';
                const badgeLabel = out ? 'Agotado' : low ? 'Bajo' : 'OK';
                const stockColor = out
                  ? 'var(--neg)'
                  : low
                    ? 'var(--warn)'
                    : 'var(--text)';
                const rowClass = out ? 'row-danger' : low ? 'row-warn' : undefined;
                return (
                  <tr key={s.product_id} className={rowClass}>
                    <td>
                      <div className="flex items-center" style={{ gap: 10 }}>
                        <div className="thumb">{initials(s.products!.name)}</div>
                        <div>
                          <div className="fw-500">{s.products!.name}</div>
                          <div className="text-2 text-xs">{s.products!.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div
                        className="flex items-center"
                        style={{ gap: 8, minWidth: 110 }}
                      >
                        <span
                          className="tnum fw-600"
                          style={{ color: stockColor, minWidth: 28 }}
                        >
                          {s.stock}
                        </span>
                        <MiniBar
                          value={s.stock}
                          max={Math.max(min * 2, s.stock, 1)}
                          tone={tone}
                        />
                      </div>
                    </td>
                    <td>
                      <Badge tone={badgeTone} dot>
                        {badgeLabel}
                      </Badge>
                    </td>
                    <td className="num tnum muted">{min}</td>
                    <td className="num tnum muted">{formatMoney(s.avg_cost ?? 0)}</td>
                    <td className="num tnum fw-500">
                      {formatMoney(Math.round(s.stock * (s.avg_cost ?? 0)))}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => setKardexFor(s.product_id)}
                        className="btn ghost sm"
                        title="Kardex"
                        aria-label="Ver kardex"
                      >
                        <List size={13} />
                      </button>
                      <button
                        onClick={() => openMov(s)}
                        className="btn ghost sm"
                        title="Movimiento"
                        aria-label="Registrar movimiento"
                      >
                        <ArrowDownUp size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {picking && (
        <ProductPicker
          sucursalId={sucursalId}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPicking(false);
            setMov({
              productId: p.id,
              name: p.name,
              currentStock: p.stock,
              kind: 'entrada',
              qty: '',
              target: String(p.stock),
              cost: '',
              lot: '',
              expiry: '',
              reason: '',
              pin: '',
            });
          }}
        />
      )}

      {mov && (
        <Modal
          title={`Movimiento: ${mov.name}`}
          onClose={() => setMov(null)}
          maxWidth={420}
          footer={
            <div className="flex gap-sm">
              <button
                onClick={() => setMov(null)}
                className="btn"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Cancelar
              </button>
              <button
                disabled={applyMov.isPending}
                onClick={() => applyMov.mutate(mov)}
                className="btn accent"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Aplicar
              </button>
            </div>
          }
        >
          {/* Selector de tipo como botones segmentados */}
          <label className="label">Tipo de movimiento</label>
          <div className="tabs" style={{ marginBottom: 14 }}>
            {(Object.keys(KIND_LABEL) as MovKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={'tab' + (mov.kind === k ? ' active' : '')}
                onClick={() => setMov({ ...mov, kind: k })}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {/* Stock actual + preview del resultado */}
          <div
            className="glass-strong flex justify-between items-center"
            style={{
              padding: '10px 12px',
              marginBottom: 14,
            }}
          >
            <div>
              <div className="text-3 text-xs">Stock actual</div>
              <div className="tnum fw-600" style={{ fontSize: 'var(--text-md)' }}>
                {mov.currentStock}
              </div>
            </div>
            {movPreview && (
              <>
                <ArrowDownUp size={14} className="text-3" />
                <div style={{ textAlign: 'right' }}>
                  <div className="text-3 text-xs">
                    Resultado{' '}
                    <span
                      className="tnum"
                      style={{
                        color:
                          movPreview.delta > 0
                            ? 'var(--pos)'
                            : movPreview.delta < 0
                              ? 'var(--neg)'
                              : 'var(--text-3)',
                      }}
                    >
                      ({movPreview.delta > 0 ? '+' : ''}
                      {movPreview.delta})
                    </span>
                  </div>
                  <div
                    className="tnum fw-600"
                    style={{
                      fontSize: 'var(--text-md)',
                      color: movPreview.next < 0 ? 'var(--neg)' : 'var(--text)',
                    }}
                  >
                    {movPreview.next}
                  </div>
                </div>
              </>
            )}
          </div>

          {mov.kind === 'ajuste' ? (
            <div>
              <label className="label">Stock físico contado</label>
              <input
                type="number"
                autoFocus
                className="field"
                value={mov.target}
                onChange={(e) => setMov({ ...mov, target: e.target.value })}
              />
            </div>
          ) : (
            <div>
              <label className="label">Cantidad</label>
              <input
                type="number"
                autoFocus
                placeholder="Cantidad"
                className="field"
                value={mov.qty}
                onChange={(e) => setMov({ ...mov, qty: e.target.value })}
              />
            </div>
          )}

          {mov.kind === 'entrada' && (
            <>
              <div>
                <label className="label">Costo unitario (pesos, opcional)</label>
                <input
                  type="number"
                  placeholder="Costo de compra"
                  className="field"
                  value={mov.cost}
                  onChange={(e) => setMov({ ...mov, cost: e.target.value })}
                />
              </div>
              <div className="flex gap-sm">
                <div style={{ flex: 1 }}>
                  <label className="label">Lote (opcional)</label>
                  <input
                    placeholder="Código de lote"
                    className="field"
                    value={mov.lot}
                    onChange={(e) => setMov({ ...mov, lot: e.target.value })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Caducidad (opcional)</label>
                  <input
                    type="date"
                    className="field"
                    value={mov.expiry}
                    onChange={(e) => setMov({ ...mov, expiry: e.target.value })}
                  />
                </div>
              </div>
            </>
          )}

          {mov.kind !== 'entrada' && (
            <div>
              <label className="label">
                Motivo {mov.kind === 'salida' ? '(opcional)' : ''}
              </label>
              <input
                placeholder="Motivo / referencia"
                className="field"
                value={mov.reason}
                onChange={(e) => setMov({ ...mov, reason: e.target.value })}
              />
            </div>
          )}

          {needsPin && (
            <div>
              <label className="label">PIN de autorización</label>
              <input
                type="password"
                placeholder="PIN"
                className="field"
                value={mov.pin}
                onChange={(e) => setMov({ ...mov, pin: e.target.value })}
              />
            </div>
          )}
        </Modal>
      )}

      {kardexFor && (
        <Modal title="Kardex" onClose={() => setKardexFor(null)} maxWidth={480}>
          <div
            className="flex justify-between items-center"
            style={{ marginBottom: 10 }}
          >
            <span className="text-2 fw-500">{kardexName}</span>
            <ExportMenu
              size="sm"
              getDatasets={kardexDataset}
              business={business}
              disabled={kardex.length === 0}
            />
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {kardex.length === 0 ? (
              <EmptyState icon={List} title="Sin movimientos" />
            ) : (
              kardex.map((k: any, i) => {
                const kind = String(k.kind) as MovKind;
                const qty = Number(k.quantity ?? 0);
                return (
                  <div
                    key={i}
                    className="flex justify-between items-center"
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div className="flex items-center" style={{ gap: 10 }}>
                      <Badge tone={KIND_TONE[kind] ?? 'default'}>
                        {KIND_KARDEX_LABEL[kind] ?? k.kind}
                      </Badge>
                      <span className="text-2 text-sm">
                        {new Date(k.created_at).toLocaleString('es-MX')}
                      </span>
                    </div>
                    <span
                      className="tnum mono fw-600"
                      style={{
                        color: qty < 0 ? 'var(--neg)' : 'var(--pos)',
                      }}
                    >
                      {qty > 0 ? '+' : ''}
                      {qty}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─── Buscador de producto para "Nueva entrada" ─────────────────────────── */
function ProductPicker({
  sucursalId,
  onClose,
  onPick,
}: {
  sucursalId: string | null;
  onClose: () => void;
  onPick: (p: { id: string; name: string; stock: number }) => void;
}) {
  const [term, setTerm] = useState('');
  const { data = [], isLoading } = useQuery({
    queryKey: ['product-pick', sucursalId, term],
    enabled: !!sucursalId,
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select('id, name, sku, branch_stock(stock)')
        .eq('sucursal_id', sucursalId!)
        .limit(20);
      if (term.trim()) q = q.ilike('name', `%${term.trim()}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  return (
    <Modal title="Nueva entrada — elige producto" onClose={onClose} maxWidth={460}>
      <div className="search-input" style={{ marginBottom: 12 }}>
        <Search size={13} />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar por nombre…"
        />
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {isLoading ? (
          <p className="text-3">Cargando…</p>
        ) : data.length === 0 ? (
          <EmptyState icon={Search} title="Sin resultados" />
        ) : (
          data.map((p: any) => {
            const stock = p.branch_stock?.[0]?.stock ?? 0;
            return (
              <button
                key={p.id}
                onClick={() => onPick({ id: p.id, name: p.name, stock })}
                className="flex justify-between items-center"
                style={{
                  width: '100%',
                  padding: '10px 8px',
                  borderBottom: '1px solid var(--border)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span className="flex items-center" style={{ gap: 10 }}>
                  <span className="thumb">{initials(p.name)}</span>
                  <span>
                    <span className="fw-500">{p.name}</span>
                    <span className="text-3 text-xs" style={{ display: 'block' }}>
                      {p.sku}
                    </span>
                  </span>
                </span>
                <span className="tnum text-2 text-sm">{stock}</span>
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
