import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { v7 as uuidv7 } from 'uuid';
import { toast } from 'sonner';
import { Lock, Search, ShoppingCart, Trash2 } from 'lucide-react';
import {
  createSaleSchema,
  formatMoney,
  lineTotalCents,
  toCents,
  type CartLine,
  type CreateSaleInput,
} from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { api, ApiRequestError } from '@/lib/apiClient';
import { enqueueOp, drainQueue } from '@/lib/syncQueue';
import { useCart, useRegister, useSucursal } from '@/lib/stores';
import { useAuth } from '@/features/auth/AuthProvider';
import { Modal } from '@/components/ui';

interface ProductRow {
  id: string;
  name: string;
  base_unit: string;
  tax_rate: number;
  product_prices: { price: number; cost: number }[];
  product_barcodes: { barcode: string }[];
}

export default function PosPage() {
  const { profile } = useAuth();
  const { sucursalId, setSucursal } = useSucursal();
  const { registerId, cashSessionId, setRegister, setCashSession } =
    useRegister();
  const cart = useCart();
  const [term, setTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openingCaja, setOpeningCaja] = useState(false);
  const cashOpen = !!cashSessionId;

  // Si no hay sucursal activa, usa la del perfil (igual que CashPage).
  useEffect(() => {
    if (!sucursalId && profile?.default_sucursal_id) {
      setSucursal(profile.default_sucursal_id);
    }
  }, [sucursalId, profile, setSucursal]);

  // Restaura una sesión de caja ya abierta en el servidor (otro día/equipo),
  // para que el POS refleje el estado real y no pida reabrir.
  useEffect(() => {
    if (!registerId || cashSessionId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('cash_sessions')
        .select('id')
        .eq('register_id', registerId)
        .eq('status', 'open')
        .maybeSingle();
      if (!cancelled && data?.id) setCashSession(data.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [registerId, cashSessionId, setCashSession]);

  const { data: products = [] } = useQuery({
    queryKey: ['products', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<ProductRow[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id,name,base_unit,tax_rate,product_prices(price,cost),product_barcodes(barcode)',
        )
        .eq('sucursal_id', sucursalId!)
        .eq('active', true)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ProductRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return products.slice(0, 24);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.product_barcodes?.some((b) => b.barcode.includes(q)),
      )
      .slice(0, 24);
  }, [term, products]);

  function addToCart(p: ProductRow) {
    const price = p.product_prices?.[0]?.price ?? 0;
    const cost = p.product_prices?.[0]?.cost ?? 0;
    const line: CartLine = {
      productId: p.id,
      variantId: null,
      description: p.name,
      quantity: 1,
      unit: p.base_unit as CartLine['unit'],
      unitPrice: price,
      unitCost: cost,
      taxRate: p.tax_rate,
      discount: 0,
    };
    cart.add(line);
  }

  async function checkout() {
    if (isSubmitting) return;
    if (!sucursalId || !registerId || !cashSessionId) {
      toast.error('Selecciona sucursal, caja y abre una sesión de caja.');
      return;
    }
    if (cart.lines.length === 0) return;

    const total = cart.totalCents();
    const payload: CreateSaleInput = {
      client_op_id: uuidv7(),
      sucursal_id: sucursalId,
      register_id: registerId,
      cash_session_id: cashSessionId,
      customer_id: null,
      tip: 0,
      items: cart.lines.map((l) => ({
        kind: 'producto',
        product_id: l.productId,
        variant_id: l.variantId,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unitPrice,
        unit_cost: l.unitCost,
        tax_rate: l.taxRate,
        discount: l.discount,
      })),
      payments: [{ method: 'efectivo', amount: total, reference: null }],
    };

    const parsed = createSaleSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(
        'Venta inválida: ' +
          (parsed.error.issues[0]?.message ?? 'datos incompletos'),
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (!navigator.onLine) {
        await enqueueOp({
          clientOpId: payload.client_op_id,
          type: 'sale.create',
          payload,
        });
        toast.info('Sin conexión: venta encolada para sincronizar.');
        cart.clear();
        return;
      }

      try {
        const res = await api<{ folio: string; total: number }>('/sales', {
          method: 'POST',
          body: payload,
          idempotencyKey: payload.client_op_id,
        });
        toast.success(`Venta ${res.folio} · ${formatMoney(res.total)}`);
        cart.clear();
        void drainQueue();
      } catch (e) {
        if (e instanceof ApiRequestError && e.status >= 500) {
          await enqueueOp({
            clientOpId: payload.client_op_id,
            type: 'sale.create',
            payload,
          });
          toast.warning('Error de servidor: venta encolada.');
          cart.clear();
        } else {
          toast.error((e as Error).message);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="pos-grid">
      <section
        style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
      >
        {!cashOpen && (
          <div
            className="flex items-center gap-sm mb-md"
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--r-md)',
              background: 'var(--warn-soft)',
              color: 'var(--warn)',
              border: '1px solid var(--warn)',
              flexWrap: 'wrap',
            }}
          >
            <Lock size={16} />
            <span className="fw-600">Caja cerrada</span>
            <span className="text-sm" style={{ flex: 1, minWidth: 120 }}>
              Ábrela para empezar a cobrar.
            </span>
            <button
              className="btn-touch"
              style={{ minHeight: 38, padding: '0 14px' }}
              onClick={() => setOpeningCaja(true)}
            >
              Abrir caja
            </button>
          </div>
        )}
        <div
          className="search-input"
          style={{ marginBottom: 14, height: 44, fontSize: 'var(--text-md)' }}
        >
          <Search size={16} />
          <input
            autoFocus
            aria-label="Buscar producto"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Escanea código de barras o busca por nombre…"
          />
        </div>
        <div
          className="product-grid"
          style={{
            flex: 1,
            overflowY: 'auto',
            alignContent: 'start',
          }}
        >
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              className="product-card"
            >
              <div
                className="thumb"
                style={{
                  width: '100%',
                  aspectRatio: '1.4',
                  height: 'auto',
                  fontSize: 15,
                }}
              >
                {p.name
                  .split(' ')
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join('')}
              </div>
              <div
                className="fw-500"
                style={{ fontSize: 13, lineHeight: 1.25 }}
              >
                {p.name}
              </div>
              <div className="fw-600 tnum text-acc" style={{ fontSize: 15 }}>
                {formatMoney(p.product_prices?.[0]?.price ?? 0)}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p
              className="text-3"
              style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center' }}
            >
              Sin productos para “{term}”.
            </p>
          )}
        </div>
      </section>

      <aside
        className="card pos-cart"
        style={{ display: 'flex', flexDirection: 'column', padding: 16 }}
      >
        <div
          className="flex items-center gap-sm mb-md"
          style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}
        >
          <ShoppingCart size={16} /> Ticket
          <span className="badge accent" style={{ marginLeft: 'auto' }}>
            {cart.lines.length} ítems
          </span>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {cart.lines.map((l, i) => (
            <div
              key={i}
              className="flex items-center"
              style={{
                gap: 8,
                background: 'var(--glass-bg)',
                borderRadius: 'var(--r)',
                padding: '8px 10px',
                fontSize: 'var(--text-sm)',
              }}
            >
              <span style={{ flex: 1 }}>
                <span className="fw-600">{l.quantity}×</span> {l.description}
              </span>
              <span className="tnum fw-500">
                {formatMoney(lineTotalCents(l.unitPrice, l.quantity, l.discount))}
              </span>
              <button
                onClick={() => cart.remove(i)}
                className="btn ghost sm"
                style={{ padding: 4, height: 24 }}
                aria-label="Quitar"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {cart.lines.length === 0 && (
            <p
              className="text-3"
              style={{ padding: '40px 0', textAlign: 'center' }}
            >
              Ticket vacío
            </p>
          )}
        </div>
        <div className="glass-strong" style={{ marginTop: 14, padding: 16 }}>
          <div
            className="flex justify-between items-center"
            style={{ marginBottom: 8 }}
          >
            <span
              className="text-2 fw-600"
              style={{
                fontSize: 'var(--text-xs)',
                textTransform: 'uppercase',
                letterSpacing: '.09em',
              }}
            >
              Total a cobrar
            </span>
            <span className="text-2 text-xs tnum">
              {cart.lines.length} ítem{cart.lines.length === 1 ? '' : 's'}
            </span>
          </div>
          <div
            className="hero-num text-acc text-glow tnum"
            style={{ fontSize: 'clamp(30px, 9vw, 42px)', marginBottom: 16 }}
          >
            {formatMoney(cart.totalCents())}
          </div>
          <button
            onClick={checkout}
            className="btn-touch"
            style={{ width: '100%' }}
            disabled={isSubmitting || cart.lines.length === 0 || !cashOpen}
          >
            {isSubmitting ? 'Cobrando…' : 'Cobrar (efectivo)'}
          </button>
        </div>
      </aside>

      {openingCaja && (
        <OpenCajaModal
          sucursalId={sucursalId}
          currentRegisterId={registerId}
          onClose={() => setOpeningCaja(false)}
          onOpened={(sessionId, regId) => {
            setRegister(regId);
            setCashSession(sessionId);
            setOpeningCaja(false);
          }}
        />
      )}
    </div>
  );
}

/* ─── Abrir sesión de caja desde el POS (reusa POST /cash/sessions) ──────── */
function OpenCajaModal({
  sucursalId,
  currentRegisterId,
  onClose,
  onOpened,
}: {
  sucursalId: string | null;
  currentRegisterId: string | null;
  onClose: () => void;
  onOpened: (sessionId: string, registerId: string) => void;
}) {
  const { data: registers = [] } = useQuery({
    queryKey: ['registers', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('registers')
        .select('id,name')
        .eq('sucursal_id', sucursalId!);
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const [registerId, setRegisterId] = useState(currentRegisterId ?? '');
  const [opening, setOpening] = useState('0');
  const [busy, setBusy] = useState(false);

  // Preselecciona la primera caja si no había una elegida.
  useEffect(() => {
    const first = registers[0];
    if (!registerId && first) setRegisterId(first.id);
  }, [registers, registerId]);

  async function submit() {
    if (busy) return;
    if (!sucursalId) {
      toast.error('Selecciona una sucursal primero.');
      return;
    }
    if (!registerId) {
      toast.error('Selecciona una caja.');
      return;
    }
    setBusy(true);
    try {
      // Si la caja ya tiene una sesión abierta, adóptala (evita duplicar).
      const { data: existing } = await supabase
        .from('cash_sessions')
        .select('id')
        .eq('register_id', registerId)
        .eq('status', 'open')
        .maybeSingle();
      if (existing?.id) {
        toast.info('Esta caja ya estaba abierta.');
        onOpened(existing.id, registerId);
        return;
      }
      const res = await api<{ id: string }>('/cash/sessions', {
        method: 'POST',
        body: {
          sucursal_id: sucursalId,
          register_id: registerId,
          opening_amount: toCents(Number(opening) || 0),
        },
      });
      toast.success('Caja abierta. ¡Listo para cobrar!');
      onOpened(res.id, registerId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Abrir caja"
      onClose={onClose}
      maxWidth={380}
      footer={
        <button
          className="btn-touch"
          style={{ width: '100%' }}
          onClick={submit}
          disabled={busy || !registerId}
        >
          {busy ? 'Abriendo…' : 'Abrir caja'}
        </button>
      }
    >
      <div>
        <label className="label">Caja</label>
        <select
          className="field"
          value={registerId}
          onChange={(e) => setRegisterId(e.target.value)}
        >
          <option value="">— Selecciona —</option>
          {registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Fondo de apertura (pesos)</label>
        <input
          type="number"
          className="field"
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          placeholder="0"
        />
      </div>
      {!sucursalId && (
        <p className="text-3 text-sm">
          Selecciona una sucursal en “Corte de caja” para continuar.
        </p>
      )}
    </Modal>
  );
}
