import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { v7 as uuidv7 } from 'uuid';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarClock,
  Pencil,
  Plus,
  Receipt,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { formatMoney, toCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';
import {
  PageHeader,
  Card,
  Modal,
  EmptyState,
  Kpi,
  Badge,
  MiniBar,
} from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { stamp, type ExportDataset } from '@/lib/export';

interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  active: boolean;
}
interface ReceiptLine {
  product_id: string;
  qty: string;
  unit_cost: string;
}
interface Payable {
  id: string;
  amount: number | null;
  paid: number | null;
  due_date: string | null;
  status: string;
  suppliers: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pagada: 'Pagada',
  parcial: 'Parcial',
  pendiente: 'Pendiente',
};

export default function PurchasingPage() {
  const sucursalId = useActiveSucursal();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'suppliers' | 'receive' | 'payables'>(
    'suppliers',
  );
  const [supForm, setSupForm] = useState<Partial<Supplier> | null>(null);
  const [lines, setLines] = useState<ReceiptLine[]>([
    { product_id: '', qty: '', unit_cost: '' },
  ]);
  const [receiveSupplier, setReceiveSupplier] = useState('');
  const [receiveCredit, setReceiveCredit] = useState(false);
  const [payAp, setPayAp] = useState<{ p: Payable; amount: string } | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<Supplier[]> => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id,name,contact,active')
        .eq('sucursal_id', sucursalId!)
        .order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-min', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('products')
        .select('id,name')
        .eq('sucursal_id', sucursalId!)
        .eq('active', true)
        .order('name')
        .limit(1000);
      return data ?? [];
    },
  });

  const { data: payables = [] } = useQuery({
    queryKey: ['payables', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('accounts_payable')
        .select('id, amount, paid, due_date, status, suppliers(name)')
        .eq('sucursal_id', sucursalId!)
        .order('due_date', { ascending: true });
      return data ?? [];
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

  const proveedoresDataset = (): ExportDataset => ({
    title: 'Proveedores',
    filename: `proveedores-${stamp()}`,
    meta: [{ label: 'Negocio', value: business }],
    rows: suppliers,
    columns: [
      { header: 'Proveedor', value: (r: Supplier) => r.name },
      { header: 'Contacto', value: (r: Supplier) => r.contact ?? '' },
      { header: 'Activo', value: (r: Supplier) => (r.active ? 'Sí' : 'No') },
    ],
  });

  const cxpDataset = (): ExportDataset => ({
    title: 'Cuentas por pagar',
    filename: `cuentas-por-pagar-${stamp()}`,
    meta: [
      { label: 'Negocio', value: business },
      { label: 'Generado', value: new Date().toLocaleString('es-MX') },
    ],
    totals: true,
    rows: payables as any[],
    columns: [
      { header: 'Proveedor', value: (r: any) => r.suppliers?.name ?? '—' },
      { header: 'Vence', value: (r: any) => r.due_date ?? '' },
      { header: 'Estatus', value: (r: any) => r.status },
      { header: 'Monto', value: (r: any) => Number(r.amount ?? 0), money: true },
      { header: 'Pagado', value: (r: any) => Number(r.paid ?? 0), money: true },
      {
        header: 'Saldo',
        value: (r: any) => Number(r.amount ?? 0) - Number(r.paid ?? 0),
        money: true,
      },
    ],
  });

  const saveSupplier = useMutation({
    mutationFn: async (s: Partial<Supplier>) => {
      const payload = {
        sucursal_id: sucursalId,
        name: (s.name ?? '').trim(),
        contact: s.contact || null,
        active: s.active ?? true,
      };
      if (s.id) {
        const { error } = await supabase
          .from('suppliers')
          .update(payload)
          .eq('id', s.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('suppliers').insert(payload);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Proveedor guardado');
      setSupForm(null);
      void qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const receive = useMutation({
    mutationFn: async () => {
      const valid = lines.filter(
        (l) => l.product_id && Number(l.qty) > 0 && Number(l.unit_cost) > 0,
      );
      if (valid.length === 0)
        throw new Error('Agrega al menos una línea con cantidad y costo');
      if (receiveCredit && !receiveSupplier)
        throw new Error('La compra a crédito requiere elegir proveedor');
      // RPC atómica: lote + entrada por línea + cuenta por pagar si es a crédito
      // (ver receive_goods en 0026_purchasing_returns.sql). Costo en centavos.
      const { error } = await supabase.rpc('receive_goods', {
        p_payload: {
          client_op_id: uuidv7(),
          sucursal_id: sucursalId,
          supplier_id: receiveSupplier || null,
          on_credit: receiveCredit,
          items: valid.map((l) => ({
            product_id: l.product_id,
            qty_received: Number(l.qty),
            unit_cost: toCents(Number(l.unit_cost) || 0),
          })),
        },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(
        receiveCredit
          ? 'Mercancía recibida — stock y cuenta por pagar actualizados'
          : 'Mercancía recibida — stock actualizado',
      );
      setLines([{ product_id: '', qty: '', unit_cost: '' }]);
      setReceiveCredit(false);
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['payables'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const payAP = useMutation({
    mutationFn: async (a: NonNullable<typeof payAp>) => {
      const cents = toCents(Number(a.amount) || 0);
      const bal = Number(a.p.amount ?? 0) - Number(a.p.paid ?? 0);
      if (cents <= 0) throw new Error('Monto inválido');
      if (cents > bal)
        throw new Error(
          `El pago (${formatMoney(cents)}) excede el saldo (${formatMoney(bal)})`,
        );
      const { error } = await supabase.rpc('register_supplier_payment', {
        p_payload: {
          payable_id: a.p.id,
          sucursal_id: sucursalId,
          amount: cents,
        },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Pago a proveedor registrado');
      setPayAp(null);
      void qc.invalidateQueries({ queryKey: ['payables'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // ── Derivados de KPIs / estado de cuentas por pagar ────────────────────────
  const payablesList = payables as unknown as Payable[];
  const saldo = (p: Payable) => Number(p.amount ?? 0) - Number(p.paid ?? 0);
  const now = new Date();
  const overdue = (p: Payable) =>
    !!p.due_date &&
    new Date(p.due_date) < now &&
    saldo(p) > 0 &&
    p.status !== 'pagada';

  const activos = suppliers.filter((s) => s.active).length;
  const totalCxp = payablesList.reduce(
    (a, p) => (saldo(p) > 0 ? a + saldo(p) : a),
    0,
  );
  const vencidas = payablesList.filter(overdue).length;
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const porVencer = payablesList.filter((p) => {
    if (!p.due_date || saldo(p) <= 0) return false;
    const d = new Date(p.due_date);
    return d >= now && d <= sevenDays;
  }).length;

  const statusTone = (status: string): 'pos' | 'info' | 'warn' =>
    status === 'pagada' ? 'pos' : status === 'parcial' ? 'info' : 'warn';

  const fmtDue = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-MX') : '—';

  const initials = (name: string) =>
    name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();

  const validLines = lines.filter((l) => l.product_id && Number(l.qty) > 0);
  // Costo de línea en centavos consistente con receive_goods: round(costo¢ × qty),
  // no toCents(pesos × qty) — así el total mostrado == el persistido.
  const lineCents = (l: ReceiptLine) =>
    Math.round(toCents(Number(l.unit_cost) || 0) * (Number(l.qty) || 0));
  const receiveTotal = lines.reduce((a, l) => a + lineCents(l), 0);

  return (
    <div className="page">
      <PageHeader
        title="Compras y proveedores"
        subtitle={`${suppliers.length} proveedores · entradas de mercancía`}
        actions={
          <div className="flex gap-sm items-center">
            <ExportMenu
              size="sm"
              label="Exportar"
              getDatasets={() => [proveedoresDataset(), cxpDataset()]}
              filename={`compras-${stamp()}`}
              business={business}
              disabled={suppliers.length === 0 && payables.length === 0}
            />
            {tab === 'suppliers' && (
              <button
                onClick={() => setSupForm({ active: true })}
                className="btn primary"
              >
                <Plus size={13} /> Nuevo proveedor
              </button>
            )}
          </div>
        }
      />

      <div className="grid grid-4 mb-lg">
        <Kpi
          label="Proveedores"
          value={String(activos)}
          icon={Users}
          hint={
            activos < suppliers.length
              ? `${suppliers.length} en total`
              : undefined
          }
        />
        <Kpi
          label="Cuentas por pagar"
          value={
            <span style={totalCxp > 0 ? { color: 'var(--neg)' } : undefined}>
              {formatMoney(totalCxp)}
            </span>
          }
          icon={Wallet}
        />
        <Kpi
          label="Vencidas"
          value={
            <span style={vencidas > 0 ? { color: 'var(--warn)' } : undefined}>
              {String(vencidas)}
            </span>
          }
          icon={AlertTriangle}
        />
        <Kpi
          label="Por vencer (7 días)"
          value={String(porVencer)}
          icon={CalendarClock}
        />
      </div>

      <div className="tabs mb-lg">
        <button
          onClick={() => setTab('suppliers')}
          className={'tab ' + (tab === 'suppliers' ? 'active' : '')}
        >
          <Users size={13} /> Proveedores
        </button>
        <button
          onClick={() => setTab('receive')}
          className={'tab ' + (tab === 'receive' ? 'active' : '')}
        >
          <Truck size={13} /> Recibir mercancía
        </button>
        <button
          onClick={() => setTab('payables')}
          className={'tab ' + (tab === 'payables' ? 'active' : '')}
        >
          <Receipt size={13} /> Cuentas por pagar
          {payablesList.length > 0 && (
            <span className="count">{payablesList.length}</span>
          )}
        </button>
      </div>

      {tab === 'suppliers' && (
        <>
          {suppliers.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Users}
                title="Sin proveedores"
                hint="Crea el primero con “Nuevo proveedor”."
                action={
                  <button
                    className="btn accent"
                    onClick={() => setSupForm({ active: true })}
                  >
                    <Plus size={13} /> Nuevo proveedor
                  </button>
                }
              />
            </div>
          ) : (
            <div className="tbl-card">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Contacto</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id} className={s.active ? '' : 'row-muted'}>
                      <td data-label="Proveedor">
                        <div className="flex items-center" style={{ gap: 10 }}>
                          <div className="thumb">{initials(s.name)}</div>
                          <span className="fw-500">{s.name}</span>
                        </div>
                      </td>
                      <td className="muted" data-label="Contacto">{s.contact || '—'}</td>
                      <td data-label="Estado">
                        <Badge tone={s.active ? 'pos' : 'default'}>
                          {s.active ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </td>
                      <td data-label="" style={{ textAlign: 'right' }}>
                        <button
                          onClick={() => setSupForm({ ...s })}
                          className="btn ghost sm"
                          aria-label={`Editar ${s.name}`}
                          title="Editar proveedor"
                        >
                          <Pencil size={13} /> Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'receive' && (
        <Card
          title="Recibir mercancía"
          sub="Cada línea suma stock al producto y registra su costo. A crédito genera la cuenta por pagar."
        >
          <div
            className="flex items-center gap-md mb-md"
            style={{ flexWrap: 'wrap' }}
          >
            <div style={{ minWidth: 220 }}>
              <label className="label">Proveedor</label>
              <select
                className="field"
                value={receiveSupplier}
                onChange={(e) => setReceiveSupplier(e.target.value)}
              >
                <option value="">— Sin proveedor —</option>
                {suppliers
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <label
              className="flex items-center gap-sm text-sm"
              style={{ marginTop: 18 }}
              title="Genera una cuenta por pagar al proveedor (con su plazo)."
            >
              <input
                type="checkbox"
                checked={receiveCredit}
                onChange={(e) => setReceiveCredit(e.target.checked)}
              />
              Compra a crédito (genera cuenta por pagar)
            </label>
          </div>
          {receiveCredit && !receiveSupplier && (
            <p className="text-xs" style={{ color: 'var(--warn)', marginBottom: 8 }}>
              Elige un proveedor para registrar la cuenta por pagar.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="receive-head text-2 text-xs fw-600">
              <span>Producto</span>
              <span>Cantidad</span>
              <span>Costo unit.</span>
              <span style={{ textAlign: 'right' }}>Subtotal</span>
              <span></span>
            </div>
            {lines.map((l, i) => {
              const subtotal = lineCents(l);
              return (
                <div key={i} className="receive-row">
                  <select
                    className="field"
                    value={l.product_id}
                    onChange={(e) => {
                      const n = [...lines];
                      n[i] = { ...l, product_id: e.target.value };
                      setLines(n);
                    }}
                  >
                    <option value="">— Producto —</option>
                    {products.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="Cant."
                    className="field"
                    value={l.qty}
                    onChange={(e) => {
                      const n = [...lines];
                      n[i] = { ...l, qty: e.target.value };
                      setLines(n);
                    }}
                  />
                  <input
                    type="number"
                    placeholder="Costo $"
                    className="field"
                    value={l.unit_cost}
                    onChange={(e) => {
                      const n = [...lines];
                      n[i] = { ...l, unit_cost: e.target.value };
                      setLines(n);
                    }}
                  />
                  <span className="num tnum text-2" style={{ textAlign: 'right' }}>
                    {formatMoney(subtotal)}
                  </span>
                  <button
                    onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                    className="btn ghost sm"
                    aria-label="Quitar línea"
                    title="Quitar línea"
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-md">
            <button
              onClick={() =>
                setLines([...lines, { product_id: '', qty: '', unit_cost: '' }])
              }
              className="btn ghost sm"
            >
              <Plus size={13} /> Agregar línea
            </button>
            <div className="flex items-center gap-md">
              <div style={{ textAlign: 'right' }}>
                <div className="text-3 text-xs">
                  {validLines.length} línea{validLines.length === 1 ? '' : 's'}{' '}
                  válida{validLines.length === 1 ? '' : 's'}
                </div>
                <div className="fw-700 num tnum">
                  Total {formatMoney(receiveTotal)}
                </div>
              </div>
              <button
                disabled={
                  receive.isPending ||
                  validLines.length === 0 ||
                  (receiveCredit && !receiveSupplier)
                }
                onClick={() => receive.mutate()}
                className="btn accent"
              >
                <Truck size={13} />{' '}
                {receive.isPending ? 'Recibiendo…' : 'Confirmar recepción'}
              </button>
            </div>
          </div>
        </Card>
      )}

      {tab === 'payables' && (
        <>
          {payablesList.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Wallet}
                title="Sin cuentas por pagar"
                hint="No hay saldos pendientes con proveedores."
              />
            </div>
          ) : (
            <div className="tbl-card">
              <div className="card-hd">
                <div>
                  <h3 className="card-title">Cuentas por pagar</h3>
                  <p className="card-sub">
                    {payablesList.length} registro
                    {payablesList.length === 1 ? '' : 's'} · saldo{' '}
                    {formatMoney(totalCxp)}
                  </p>
                </div>
                <ExportMenu
                  size="sm"
                  getDatasets={cxpDataset}
                  business={business}
                />
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Vence</th>
                    <th>Estatus</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                    <th>Pagado</th>
                    <th style={{ textAlign: 'right' }}>Saldo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payablesList.map((p, i) => {
                    const amount = Number(p.amount ?? 0);
                    const paid = Number(p.paid ?? 0);
                    const bal = saldo(p);
                    const isOverdue = overdue(p);
                    return (
                      <tr key={i} className={isOverdue ? 'row-danger' : ''}>
                        <td className="fw-500" data-label="Proveedor">{p.suppliers?.name ?? '—'}</td>
                        <td data-label="Vence">
                          <span className="flex items-center gap-xs">
                            <span className="text-2">{fmtDue(p.due_date)}</span>
                            {isOverdue && <Badge tone="neg">Vencida</Badge>}
                          </span>
                        </td>
                        <td data-label="Estatus">
                          <Badge tone={statusTone(p.status)}>
                            {STATUS_LABEL[p.status] ?? p.status}
                          </Badge>
                        </td>
                        <td className="num tnum" data-label="Monto">{formatMoney(amount)}</td>
                        <td data-label="Pagado">
                          <div
                            className="flex items-center gap-xs"
                            style={{ minWidth: 120 }}
                          >
                            <MiniBar
                              value={paid}
                              max={amount}
                              tone="pos"
                              width={80}
                            />
                            <span className="text-2 text-xs tnum">
                              {formatMoney(paid)}
                            </span>
                          </div>
                        </td>
                        <td className="num tnum fw-600" data-label="Saldo">
                          <span
                            style={bal > 0 ? { color: 'var(--neg)' } : undefined}
                          >
                            {formatMoney(bal)}
                          </span>
                        </td>
                        <td data-label="" style={{ textAlign: 'right' }}>
                          {bal > 0 && (
                            <button
                              onClick={() => setPayAp({ p, amount: '' })}
                              className="btn ghost sm"
                              title="Registrar pago"
                              aria-label="Registrar pago"
                            >
                              <Wallet size={13} /> Pagar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {supForm && (
        <Modal
          title={`${supForm.id ? 'Editar' : 'Nuevo'} proveedor`}
          onClose={() => setSupForm(null)}
          footer={
            <button
              disabled={saveSupplier.isPending || !supForm.name?.trim()}
              onClick={() => saveSupplier.mutate(supForm)}
              className="btn accent"
              style={{ width: '100%', height: 38, justifyContent: 'center' }}
            >
              {saveSupplier.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          }
        >
          <div>
            <label className="label">Nombre</label>
            <input
              autoFocus
              className="field"
              placeholder="Nombre"
              value={supForm.name ?? ''}
              onChange={(e) => setSupForm({ ...supForm, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Contacto</label>
            <input
              className="field"
              placeholder="Contacto (tel/correo)"
              value={supForm.contact ?? ''}
              onChange={(e) =>
                setSupForm({ ...supForm, contact: e.target.value })
              }
            />
          </div>
          <label className="flex items-center gap-sm text-sm mt-md">
            <input
              type="checkbox"
              checked={supForm.active ?? true}
              onChange={(e) =>
                setSupForm({ ...supForm, active: e.target.checked })
              }
            />
            Activo
          </label>
        </Modal>
      )}

      {payAp && (
        <Modal
          title={`Pago · ${payAp.p.suppliers?.name ?? 'Proveedor'}`}
          onClose={() => setPayAp(null)}
          maxWidth={400}
          footer={
            <div className="flex gap-sm">
              <button
                onClick={() => setPayAp(null)}
                className="btn"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Cancelar
              </button>
              <button
                disabled={
                  payAP.isPending ||
                  toCents(Number(payAp.amount) || 0) <= 0 ||
                  toCents(Number(payAp.amount) || 0) > saldo(payAp.p)
                }
                onClick={() => payAP.mutate(payAp)}
                className="btn accent"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {payAP.isPending ? 'Registrando…' : 'Registrar pago'}
              </button>
            </div>
          }
        >
          <p className="text-sm text-3 mb-md">
            Saldo pendiente: {formatMoney(saldo(payAp.p))}
          </p>
          <div>
            <label className="label">Monto del pago ($)</label>
            <input
              type="number"
              autoFocus
              placeholder="Monto del pago ($)"
              className="field"
              value={payAp.amount}
              onChange={(e) => setPayAp({ ...payAp, amount: e.target.value })}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
