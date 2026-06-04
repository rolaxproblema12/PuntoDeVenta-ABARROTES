import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Clock,
  Eye,
  History,
  Lock,
  LockOpen,
  Receipt,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react';
import {
  MXN_DENOMINATIONS,
  formatMoney,
  toCents,
  type CashSessionSummary,
} from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { useRegister, useSucursal } from '@/lib/stores';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  PageHeader,
  Card,
  Badge,
  Modal,
  Kpi,
  EmptyState,
  BarList,
} from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import { stamp, type ExportDataset } from '@/lib/export';

type MoveKind = 'ingreso' | 'retiro';

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
  credito: 'Crédito',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDuration(fromIso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

export default function CashPage() {
  const { profile, tenant } = useAuth();
  const qc = useQueryClient();
  const { sucursalId, setSucursal } = useSucursal();
  const { registerId, setRegister, cashSessionId, setCashSession } =
    useRegister();
  const [opening, setOpening] = useState('0');
  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [zResult, setZResult] = useState<CashSessionSummary | null>(null);
  const [viewSession, setViewSession] = useState<string | null>(null);
  const [moveForm, setMoveForm] = useState<{
    kind: MoveKind;
    amount: string;
    reason: string;
  } | null>(null);
  const [closeForm, setCloseForm] = useState<{
    denoms: Record<string, string>;
    pin: string;
  } | null>(null);

  useEffect(() => {
    if (!sucursalId && profile?.default_sucursal_id) {
      setSucursal(profile.default_sucursal_id);
    }
  }, [profile, sucursalId, setSucursal]);

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales', tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('sucursales')
        .select('id,name,code')
        .eq('tenant_id', tenant!.id);
      return data ?? [];
    },
  });

  const { data: registers = [] } = useQuery({
    queryKey: ['registers', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('registers')
        .select('id,name')
        .eq('sucursal_id', sucursalId!);
      return data ?? [];
    },
  });
  const regName = (id: string | null | undefined) =>
    (registers as any[]).find((r) => r.id === id)?.name ?? '—';

  // Corte X (lectura): se recalcula tras cada movimiento/venta.
  const { data: summary } = useQuery({
    queryKey: ['cash-summary', cashSessionId],
    enabled: !!cashSessionId,
    queryFn: () =>
      api<CashSessionSummary>(`/cash/sessions/${cashSessionId}/summary`),
  });

  // Metadatos de la sesión abierta: hora de apertura, quién y caja.
  const { data: sessionMeta } = useQuery({
    queryKey: ['cash-session-meta', cashSessionId],
    enabled: !!cashSessionId,
    queryFn: async () => {
      const { data: s } = await supabase
        .from('cash_sessions')
        .select('opened_at, opened_by, register_id')
        .eq('id', cashSessionId!)
        .maybeSingle();
      if (!s) return null;
      let openerName = '';
      if (s.opened_by) {
        const { data: p } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', s.opened_by)
          .maybeSingle();
        openerName = p?.full_name ?? '';
      }
      return { ...s, openerName } as {
        opened_at: string;
        opened_by: string | null;
        register_id: string;
        openerName: string;
      };
    },
  });

  // Movimientos (ingresos/retiros) de la sesión.
  const { data: movements = [] } = useQuery({
    queryKey: ['cash-movements', cashSessionId],
    enabled: !!cashSessionId,
    queryFn: async () => {
      const { data } = await supabase
        .from('cash_movements')
        .select('kind, amount, reason, created_at')
        .eq('cash_session_id', cashSessionId!)
        .order('created_at', { ascending: false });
      return (data ?? []) as {
        kind: MoveKind;
        amount: number;
        reason: string;
        created_at: string;
      }[];
    },
  });

  // Tickets (ventas) de la sesión.
  const { data: sessionSales = [] } = useQuery({
    queryKey: ['cash-session-sales', cashSessionId],
    enabled: !!cashSessionId,
    queryFn: async () => {
      const { data } = await supabase
        .from('sales')
        .select('folio, total, payment_method, status, created_at')
        .eq('cash_session_id', cashSessionId!)
        .order('created_at', { ascending: false })
        .limit(100);
      return (data ?? []) as {
        folio: string;
        total: number;
        payment_method: string;
        status: string;
        created_at: string;
      }[];
    },
  });

  // Historial de cortes (sesiones cerradas de la sucursal).
  const { data: history = [] } = useQuery({
    queryKey: ['cash-history', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('cash_sessions')
        .select(
          'id, register_id, opened_at, closed_at, opening_amount, expected_cash, counted_cash, difference',
        )
        .eq('sucursal_id', sucursalId!)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(20);
      return (data ?? []) as any[];
    },
  });

  async function openSession() {
    if (isOpening) return;
    if (!sucursalId || !registerId) {
      toast.error('Selecciona sucursal y caja');
      return;
    }
    setIsOpening(true);
    try {
      const res = await api<{ id: string }>('/cash/sessions', {
        method: 'POST',
        body: {
          sucursal_id: sucursalId,
          register_id: registerId,
          opening_amount: toCents(Number(opening) || 0),
        },
      });
      setCashSession(res.id);
      toast.success('Sesión de caja abierta');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsOpening(false);
    }
  }

  async function submitMove() {
    if (!cashSessionId || !moveForm) return;
    const amount = Number(moveForm.amount);
    if (!amount || amount <= 0) {
      toast.error('Monto inválido');
      return;
    }
    if (!moveForm.reason.trim()) {
      toast.error('Indica el motivo');
      return;
    }
    try {
      await api(`/cash/sessions/${cashSessionId}/movements`, {
        method: 'POST',
        body: {
          kind: moveForm.kind,
          amount: toCents(amount),
          reason: moveForm.reason.trim(),
        },
      });
      toast.success(
        moveForm.kind === 'ingreso' ? 'Ingreso registrado' : 'Retiro registrado',
      );
      setMoveForm(null);
      void qc.invalidateQueries({ queryKey: ['cash-summary'] });
      void qc.invalidateQueries({ queryKey: ['cash-movements'] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const countedCents = closeForm
    ? MXN_DENOMINATIONS.reduce(
        (a, d) => a + d.cents * (Number(closeForm.denoms[d.cents]) || 0),
        0,
      )
    : 0;
  const expectedCents = summary?.expected_cash ?? 0;
  const diffCents = countedCents - expectedCents;

  async function submitClose() {
    if (isClosing || !cashSessionId || !closeForm) return;
    if (!closeForm.pin.trim()) {
      toast.error('PIN de supervisor requerido');
      return;
    }
    const denominations: Record<string, number> = {};
    for (const d of MXN_DENOMINATIONS) {
      const n = Number(closeForm.denoms[d.cents]) || 0;
      if (n > 0) denominations[d.cents] = n;
    }
    setIsClosing(true);
    try {
      const res = await api<CashSessionSummary>(
        `/cash/sessions/${cashSessionId}/close`,
        {
          method: 'POST',
          body: { counted_cash: countedCents, denominations },
          pin: closeForm.pin.trim(),
        },
      );
      setCashSession(null);
      setCloseForm(null);
      setZResult(res);
      void qc.invalidateQueries({ queryKey: ['cash-history'] });
      toast.success(
        `Caja cerrada. Diferencia: ${formatMoney(res.difference ?? 0)}`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsClosing(false);
    }
  }

  const sucName = (sucursales as any[]).find((x) => x.id === sucursalId);
  const business = sucName ? `${sucName.code} · ${sucName.name}` : 'POS';

  // Historial: abierto por defecto en escritorio, plegado en móvil (menos scroll).
  const [historyOpen, setHistoryOpen] = useState(
    () =>
      typeof window === 'undefined' ||
      window.matchMedia('(min-width: 769px)').matches,
  );

  return (
    <div className="page">
      <PageHeader
        title="Caja / Cortes"
        subtitle="Apertura, movimientos de efectivo y corte (X/Z)"
        actions={
          cashSessionId && summary ? (
            <ExportMenu
              size="sm"
              label="Descargar corte X"
              getDatasets={() => cutDataset(summary, 'X', business)}
              business={business}
            />
          ) : undefined
        }
      />

      {!cashSessionId ? (
        /* ─── Caja cerrada: configurar y abrir ─────────────────────────── */
        <div style={{ maxWidth: 760, marginBottom: 28 }}>
          {/* Momento hero: bienvenida de apertura */}
          <div
            className="glass-strong flex items-center gap-md"
            style={{ padding: '22px 24px', marginBottom: 18 }}
          >
            <div
              className="flex items-center justify-center"
              style={{
                width: 56,
                height: 56,
                borderRadius: 'var(--r-lg)',
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              <LockOpen size={28} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h2
                style={{
                  margin: 0,
                  fontWeight: 800,
                  fontSize: 'var(--text-lg, 20px)',
                  letterSpacing: '-0.02em',
                }}
              >
                Inicia tu jornada en caja
              </h2>
              <p className="text-2 text-sm" style={{ margin: '4px 0 0' }}>
                Elige sucursal y caja, captura tu fondo de apertura y abre la
                sesión para empezar a vender.
              </p>
            </div>
          </div>

          <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <Card title="Configuración">
            <div className="mb-md">
              <label className="label">Sucursal</label>
              <select
                value={sucursalId ?? ''}
                onChange={(e) => setSucursal(e.target.value)}
                className="field"
              >
                <option value="">— Selecciona —</option>
                {sucursales.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Caja</label>
              <select
                value={registerId ?? ''}
                onChange={(e) => setRegister(e.target.value)}
                className="field"
              >
                <option value="">— Selecciona —</option>
                {registers.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          <Card title="Abrir sesión">
            <div className="mb-md">
              <label className="label">Fondo de apertura (pesos)</label>
              <input
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                type="number"
                className="field"
              />
            </div>
            <button
              onClick={openSession}
              disabled={isOpening}
              className="btn-touch primary"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <LockOpen size={16} />{' '}
              {isOpening ? 'Abriendo…' : 'Abrir sesión de caja'}
            </button>
          </Card>
          </div>
        </div>
      ) : (
        /* ─── Caja abierta: panel completo ─────────────────────────────── */
        <>
          {/* Momento hero: encabezado de sesión + efectivo esperado gigante */}
          <div
            className="glass-strong"
            style={{ padding: '20px 24px', marginBottom: 16 }}
          >
            <div
              className="flex items-start gap-lg"
              style={{ flexWrap: 'wrap' }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="flex items-center gap-sm">
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>
                    {sessionMeta ? regName(sessionMeta.register_id) : 'Caja'}
                  </span>
                  <Badge tone="pos" dot>
                    Sesión abierta
                  </Badge>
                </div>
                {sessionMeta && (
                  <div
                    className="flex items-center gap-md text-2 text-xs"
                    style={{ marginTop: 4, flexWrap: 'wrap' }}
                  >
                    <span className="flex items-center gap-xs">
                      <Clock size={12} /> Abierta {fmtDateTime(sessionMeta.opened_at)} ·{' '}
                      {fmtDuration(sessionMeta.opened_at)}
                    </span>
                    {sessionMeta.openerName && (
                      <span className="flex items-center gap-xs">
                        <User size={12} /> {sessionMeta.openerName}
                      </span>
                    )}
                  </div>
                )}

                {/* Cifra hero: efectivo esperado en el cajón */}
                <div style={{ marginTop: 18 }}>
                  <div className="flex items-center gap-xs text-2 text-sm">
                    <Banknote size={14} /> Efectivo esperado en el cajón
                  </div>
                  <div
                    className="hero-num text-acc text-glow"
                    style={{ fontSize: 'clamp(28px, 8vw, 40px)', marginTop: 6 }}
                  >
                    {formatMoney(summary?.expected_cash ?? 0)}
                  </div>
                </div>
              </div>

              <div className="actions-grid" style={{ justifyContent: 'flex-end' }}>
                <button
                  onClick={() =>
                    setMoveForm({ kind: 'ingreso', amount: '', reason: '' })
                  }
                  className="btn"
                >
                  <ArrowDownToLine size={15} /> Ingreso
                </button>
                <button
                  onClick={() =>
                    setMoveForm({ kind: 'retiro', amount: '', reason: '' })
                  }
                  className="btn"
                >
                  <ArrowUpFromLine size={15} /> Retiro
                </button>
                <button onClick={() => setShowSummary(true)} className="btn">
                  <Eye size={15} /> Corte X
                </button>
                <button
                  onClick={() => setCloseForm({ denoms: {}, pin: '' })}
                  className="btn"
                  style={{
                    borderColor: 'var(--neg)',
                    color: 'var(--neg)',
                  }}
                >
                  <Lock size={15} /> Cerrar caja (Z)
                </button>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              marginTop: 16,
            }}
          >
            <Kpi
              label="Efectivo esperado"
              value={formatMoney(summary?.expected_cash ?? 0)}
              icon={Banknote}
              hint="En el cajón al cerrar"
            />
            <Kpi
              label="Venta total"
              value={formatMoney(summary?.sales_total ?? 0)}
              icon={TrendingUp}
              hint={`${summary?.ticket_count ?? 0} tickets`}
            />
            <Kpi
              label="Tickets"
              value={String(summary?.ticket_count ?? 0)}
              icon={Receipt}
            />
            <Kpi
              label="Fondo de apertura"
              value={formatMoney(summary?.opening_amount ?? 0)}
              icon={Wallet}
            />
            <Kpi
              label="Ingresos"
              value={formatMoney(summary?.cash_in ?? 0)}
              icon={ArrowDownToLine}
            />
            <Kpi
              label="Retiros"
              value={formatMoney(summary?.cash_out ?? 0)}
              icon={ArrowUpFromLine}
            />
          </div>

          {/* Desglose por método + movimientos */}
          <div
            className="grid grid-2"
            style={{ alignItems: 'start', marginTop: 16 }}
          >
            <Card title="Ventas por método de pago">
              {summary ? (
                <BarList
                  rows={[
                    {
                      label: 'Efectivo',
                      value: summary.by_method.efectivo,
                      display: formatMoney(summary.by_method.efectivo),
                    },
                    {
                      label: 'Tarjeta',
                      value: summary.by_method.tarjeta,
                      display: formatMoney(summary.by_method.tarjeta),
                    },
                    {
                      label: 'Transferencia',
                      value: summary.by_method.transferencia,
                      display: formatMoney(summary.by_method.transferencia),
                    },
                    {
                      label: 'Crédito',
                      value: summary.by_method.credito,
                      display: formatMoney(summary.by_method.credito),
                    },
                  ]}
                />
              ) : (
                <p className="text-2 text-sm">Cargando…</p>
              )}
            </Card>

            <Card
              title="Movimientos de la sesión"
              sub={`${movements.length} registrados`}
            >
              {movements.length === 0 ? (
                <EmptyState
                  title="Sin movimientos"
                  hint="Los ingresos y retiros aparecerán aquí."
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {movements.map((mv, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-sm"
                      style={{
                        padding: '8px 0',
                        borderTop: i ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      {mv.kind === 'ingreso' ? (
                        <ArrowDownToLine size={15} style={{ color: 'var(--pos)' }} />
                      ) : (
                        <ArrowUpFromLine size={15} style={{ color: 'var(--neg)' }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className="fw-500"
                          style={{
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {mv.reason}
                        </div>
                        <div className="text-2 text-xs">
                          {fmtDateTime(mv.created_at)}
                        </div>
                      </div>
                      <span
                        className="tnum fw-500"
                        style={{
                          color:
                            mv.kind === 'ingreso' ? 'var(--pos)' : 'var(--neg)',
                        }}
                      >
                        {mv.kind === 'ingreso' ? '+' : '−'}
                        {formatMoney(mv.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Tickets de la sesión */}
          <SectionTitle icon={Receipt} title="Tickets de la sesión" count={sessionSales.length} />
          {sessionSales.length === 0 ? (
            <Card>
              <EmptyState
                title="Sin ventas aún"
                hint="Las ventas cobradas en esta caja aparecerán aquí."
              />
            </Card>
          ) : (
            <div className="tbl-card">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Hora</th>
                    <th>Método</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionSales.map((t) => (
                    <tr key={t.folio}>
                      <td className="fw-500 mono" data-label="Folio">{t.folio}</td>
                      <td className="muted" data-label="Hora">{fmtDateTime(t.created_at)}</td>
                      <td data-label="Método">
                        {METHOD_LABEL[t.payment_method] ?? t.payment_method}
                        {t.status !== 'completada' && (
                          <span className="text-neg text-xs"> · {t.status}</span>
                        )}
                      </td>
                      <td
                        className="num tnum fw-500"
                        data-label="Total"
                        style={{
                          textDecoration:
                            t.status === 'completada' ? 'none' : 'line-through',
                        }}
                      >
                        {formatMoney(t.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Historial de cortes — plegable (cerrado por defecto en móvil) */}
      <details
        className="section-collapse"
        open={historyOpen}
        onToggle={(e) =>
          setHistoryOpen((e.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary>
          <History size={15} /> Historial de cortes (Z){' '}
          <span className="count">{history.length}</span>
        </summary>
        {history.length === 0 ? (
          <Card>
            <EmptyState
              title="Sin cortes todavía"
              hint="Los cierres de caja anteriores aparecerán aquí."
            />
          </Card>
        ) : (
          <div className="tbl-card" style={{ marginTop: 10 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cierre</th>
                  <th>Caja</th>
                  <th style={{ textAlign: 'right' }}>Esperado</th>
                  <th style={{ textAlign: 'right' }}>Contado</th>
                  <th style={{ textAlign: 'right' }}>Diferencia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const diff = h.difference ?? 0;
                  return (
                    <tr key={h.id}>
                      <td className="fw-500" data-label="Cierre">
                        {fmtDateTime(h.closed_at)}
                      </td>
                      <td className="muted" data-label="Caja">
                        {regName(h.register_id)}
                      </td>
                      <td className="num tnum muted" data-label="Esperado">
                        {formatMoney(h.expected_cash ?? 0)}
                      </td>
                      <td className="num tnum" data-label="Contado">
                        {formatMoney(h.counted_cash ?? 0)}
                      </td>
                      <td
                        className="num tnum fw-500"
                        data-label="Diferencia"
                        style={{
                          color: diff === 0 ? 'var(--pos)' : 'var(--neg)',
                        }}
                      >
                        {formatMoney(diff)}
                      </td>
                      <td style={{ textAlign: 'right' }} data-label="">
                        <button
                          onClick={() => setViewSession(h.id)}
                          className="btn ghost sm"
                          title="Ver corte"
                          aria-label="Ver corte"
                        >
                          <Eye size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </details>

      {/* Movimiento de efectivo */}
      {moveForm && (
        <Modal
          title={
            moveForm.kind === 'ingreso'
              ? 'Ingreso de efectivo'
              : 'Retiro de efectivo'
          }
          onClose={() => setMoveForm(null)}
          maxWidth={400}
          footer={
            <button
              onClick={submitMove}
              className="btn accent"
              style={{ width: '100%', height: 38, justifyContent: 'center' }}
            >
              Registrar
            </button>
          }
        >
          <div className="mb-md">
            <label className="label">Monto (pesos)</label>
            <input
              autoFocus
              type="number"
              className="field"
              value={moveForm.amount}
              onChange={(e) =>
                setMoveForm({ ...moveForm, amount: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">Motivo</label>
            <input
              className="field"
              placeholder={
                moveForm.kind === 'ingreso'
                  ? 'p. ej. fondo extra'
                  : 'p. ej. pago a proveedor'
              }
              value={moveForm.reason}
              onChange={(e) =>
                setMoveForm({ ...moveForm, reason: e.target.value })
              }
            />
          </div>
        </Modal>
      )}

      {/* Corte X (lectura) */}
      {showSummary && summary && (
        <Modal
          title="Corte X (lectura)"
          onClose={() => setShowSummary(false)}
          maxWidth={420}
        >
          <div className="flex justify-end" style={{ marginBottom: 10 }}>
            <ExportMenu
              size="sm"
              label="Descargar corte"
              getDatasets={() => cutDataset(summary, 'X', business)}
              business={business}
            />
          </div>
          <SummaryDetail s={summary} />
        </Modal>
      )}

      {/* Resumen Z post-cierre */}
      {zResult && (
        <Modal
          title="Corte Z — caja cerrada"
          onClose={() => setZResult(null)}
          maxWidth={420}
        >
          <div className="flex justify-end" style={{ marginBottom: 10 }}>
            <ExportMenu
              size="sm"
              label="Descargar corte"
              getDatasets={() => cutDataset(zResult, 'Z', business)}
              business={business}
            />
          </div>
          <SummaryDetail s={zResult} />
        </Modal>
      )}

      {/* Ver un corte del historial */}
      {viewSession && (
        <HistorySessionModal
          sessionId={viewSession}
          business={business}
          onClose={() => setViewSession(null)}
        />
      )}

      {/* Cierre con conteo de denominaciones */}
      {closeForm && (
        <Modal
          title="Cerrar caja — conteo de efectivo"
          onClose={() => setCloseForm(null)}
          maxWidth={440}
          footer={
            <button
              disabled={isClosing}
              onClick={submitClose}
              className="btn accent"
              style={{ width: '100%', height: 38, justifyContent: 'center' }}
            >
              {isClosing ? 'Cerrando…' : 'Confirmar cierre'}
            </button>
          }
        >
          <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
            {MXN_DENOMINATIONS.map((d) => {
              const n = Number(closeForm.denoms[d.cents]) || 0;
              return (
                <div
                  key={d.cents}
                  className="flex items-center gap-sm"
                  style={{ padding: '4px 0' }}
                >
                  <span style={{ width: 64 }} className="tnum">
                    {d.label}
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>×</span>
                  <input
                    type="number"
                    className="field"
                    style={{ width: 90 }}
                    value={closeForm.denoms[d.cents] ?? ''}
                    onChange={(e) =>
                      setCloseForm({
                        ...closeForm,
                        denoms: {
                          ...closeForm.denoms,
                          [d.cents]: e.target.value,
                        },
                      })
                    }
                  />
                  <span
                    className="tnum"
                    style={{ marginLeft: 'auto', color: 'var(--text-2)' }}
                  >
                    {formatMoney(d.cents * n)}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <SumRow label="Contado" value={formatMoney(countedCents)} strong />
            <SumRow label="Esperado" value={formatMoney(expectedCents)} />
            <SumRow
              label="Diferencia"
              value={formatMoney(diffCents)}
              tone={diffCents === 0 ? 'pos' : 'neg'}
              strong
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="label">PIN de supervisor (cierre)</label>
            <input
              type="password"
              className="field"
              value={closeForm.pin}
              onChange={(e) =>
                setCloseForm({ ...closeForm, pin: e.target.value })
              }
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─── encabezado de sección ─────────────────────────────────────────────── */
function SectionTitle({
  icon: IconCmp,
  title,
  count,
}: {
  icon: typeof Receipt;
  title: string;
  count?: number;
}) {
  return (
    <div
      className="flex items-center gap-sm"
      style={{ margin: '24px 0 10px' }}
    >
      <IconCmp size={15} className="text-2" />
      <span className="fw-600">{title}</span>
      {count != null && <span className="text-2 text-sm">· {count}</span>}
    </div>
  );
}

/* ─── ver un corte cerrado (reusa /summary + exportación) ────────────────── */
function HistorySessionModal({
  sessionId,
  business,
  onClose,
}: {
  sessionId: string;
  business: string;
  onClose: () => void;
}) {
  const { data: s, isLoading } = useQuery({
    queryKey: ['cash-summary-view', sessionId],
    queryFn: () =>
      api<CashSessionSummary>(`/cash/sessions/${sessionId}/summary`),
  });
  return (
    <Modal title="Corte Z (histórico)" onClose={onClose} maxWidth={420}>
      {isLoading || !s ? (
        <p className="text-2 text-sm">Cargando…</p>
      ) : (
        <>
          <div className="flex justify-end" style={{ marginBottom: 10 }}>
            <ExportMenu
              size="sm"
              label="Descargar corte"
              getDatasets={() => cutDataset(s, 'Z', business)}
              business={business}
            />
          </div>
          <SummaryDetail s={s} />
        </>
      )}
    </Modal>
  );
}

/* ─── dataset de exportación del corte ──────────────────────────────────── */
function cutDataset(
  s: CashSessionSummary,
  kind: 'X' | 'Z',
  business: string,
): ExportDataset {
  const rows: { c: string; v: string }[] = [
    { c: 'Fondo de apertura', v: formatMoney(s.opening_amount) },
    { c: 'Ventas efectivo', v: formatMoney(s.by_method.efectivo) },
    { c: 'Ventas tarjeta', v: formatMoney(s.by_method.tarjeta) },
    { c: 'Ventas transferencia', v: formatMoney(s.by_method.transferencia) },
    { c: 'Ventas crédito', v: formatMoney(s.by_method.credito) },
    { c: 'Ingresos de efectivo', v: formatMoney(s.cash_in) },
    { c: 'Retiros de efectivo', v: formatMoney(s.cash_out) },
    { c: 'Devoluciones efectivo', v: formatMoney(s.cash_refunds) },
    { c: '# Tickets', v: String(s.ticket_count) },
    { c: 'Venta total', v: formatMoney(s.sales_total) },
    { c: 'Efectivo esperado', v: formatMoney(s.expected_cash) },
  ];
  if (s.counted_cash !== undefined) {
    rows.push({ c: 'Efectivo contado', v: formatMoney(s.counted_cash) });
    rows.push({ c: 'Diferencia', v: formatMoney(s.difference ?? 0) });
  }
  if (s.denominations) {
    for (const d of MXN_DENOMINATIONS) {
      const n = Number((s.denominations as Record<string, number>)[d.cents] ?? 0);
      if (n > 0)
        rows.push({
          c: `Denominación ${d.label} × ${n}`,
          v: formatMoney(d.cents * n),
        });
    }
  }
  return {
    title: `Corte ${kind}`,
    filename: `corte-${kind}-${stamp()}`,
    meta: [
      { label: 'Negocio', value: business },
      { label: 'Tipo', value: kind === 'Z' ? 'Cierre (Z)' : 'Lectura (X)' },
      { label: 'Generado', value: new Date().toLocaleString('es-MX') },
    ],
    rows,
    columns: [
      { header: 'Concepto', value: (r: { c: string; v: string }) => r.c },
      { header: 'Valor', value: (r: { c: string; v: string }) => r.v },
    ],
  };
}

/* ─── helpers de presentación ───────────────────────────────────────────── */
function SumRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'pos' | 'neg';
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-2 text-sm">{label}</span>
      <span
        className="tnum"
        style={{
          fontWeight: strong ? 600 : 400,
          color:
            tone === 'pos'
              ? 'var(--pos)'
              : tone === 'neg'
                ? 'var(--neg)'
                : 'var(--text)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SummaryDetail({ s }: { s: CashSessionSummary }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <SumRow label="Fondo de apertura" value={formatMoney(s.opening_amount)} />
      <SumRow label="Efectivo" value={formatMoney(s.by_method.efectivo)} />
      <SumRow label="Tarjeta" value={formatMoney(s.by_method.tarjeta)} />
      <SumRow
        label="Transferencia"
        value={formatMoney(s.by_method.transferencia)}
      />
      <SumRow label="Crédito" value={formatMoney(s.by_method.credito)} />
      <SumRow label="Ingresos de efectivo" value={formatMoney(s.cash_in)} />
      <SumRow label="Retiros de efectivo" value={formatMoney(s.cash_out)} />
      <SumRow label="Devoluciones efectivo" value={formatMoney(s.cash_refunds)} />
      <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
      <SumRow label="Tickets" value={String(s.ticket_count)} />
      <SumRow label="Venta total" value={formatMoney(s.sales_total)} />
      <SumRow
        label="Efectivo esperado"
        value={formatMoney(s.expected_cash)}
        strong
      />
      {s.counted_cash !== undefined && (
        <>
          <SumRow label="Efectivo contado" value={formatMoney(s.counted_cash)} />
          <SumRow
            label="Diferencia"
            value={formatMoney(s.difference ?? 0)}
            tone={(s.difference ?? 0) === 0 ? 'pos' : 'neg'}
            strong
          />
        </>
      )}
    </div>
  );
}
