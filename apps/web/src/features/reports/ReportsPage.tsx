import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Receipt, TrendingUp } from 'lucide-react';
import { formatMoney, fromCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';
import { PageHeader, Card, Kpi, AreaChart, EmptyState } from '@/components/ui';
import { ExportMenu } from '@/components/ExportMenu';
import {
  PeriodPicker,
  defaultPeriod,
  type Period,
} from '@/components/PeriodPicker';
import type { ExportDataset, ExportMetaLine } from '@/lib/export';

const METHOD_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
  credito: 'Crédito',
};

interface Sale {
  folio: string;
  created_at: string;
  payment_method: string;
  status: string;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  total: number;
}

export default function ReportsPage() {
  const sucursalId = useActiveSucursal();
  const [period, setPeriod] = useState<Period>(() => defaultPeriod(14));
  const toBound = period.to + 'T23:59:59';

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

  const { data: daily = [] } = useQuery({
    queryKey: ['rep-daily', sucursalId, period.from, period.to],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('v_sales_daily')
        .select('day, ventas, total, iva')
        .eq('sucursal_id', sucursalId!)
        .gte('day', period.from)
        .lte('day', period.to)
        .order('day', { ascending: true });
      return data ?? [];
    },
  });

  const { data: ledger = [] } = useQuery({
    queryKey: ['rep-ledger', sucursalId, period.from, period.to],
    enabled: !!sucursalId,
    queryFn: async (): Promise<Sale[]> => {
      const { data } = await supabase
        .from('sales')
        .select(
          'folio, created_at, payment_method, status, subtotal, tax_total, discount_total, total',
        )
        .eq('sucursal_id', sucursalId!)
        .gte('created_at', period.from)
        .lte('created_at', toBound)
        .order('created_at', { ascending: false })
        .limit(5000);
      return (data ?? []) as Sale[];
    },
  });

  const { data: topRaw = [] } = useQuery({
    queryKey: ['rep-top', sucursalId, period.from, period.to],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('sale_items')
        .select(
          'product_id, description, quantity, line_total, sales!inner(created_at, status)',
        )
        .eq('sucursal_id', sucursalId!)
        .in('sales.status', ['completada', 'devuelta'])
        .gte('sales.created_at', period.from)
        .lte('sales.created_at', toBound)
        .limit(10000);
      return data ?? [];
    },
  });

  // Devoluciones del periodo (para netear el top de productos, igual que los KPIs).
  const { data: topReturns = [] } = useQuery({
    queryKey: ['rep-top-returns', sucursalId, period.from, period.to],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('return_items')
        .select(
          'quantity, refund_amount, sale_items!inner(product_id, description), returns!inner(sucursal_id, created_at)',
        )
        .eq('returns.sucursal_id', sucursalId!)
        .gte('returns.created_at', period.from)
        .lte('returns.created_at', toBound)
        .limit(10000);
      return data ?? [];
    },
  });

  // Top productos agregado en cliente, NETEADO por devoluciones.
  const top = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const r of topRaw as any[]) {
      const k = r.product_id ?? r.description;
      const cur = map.get(k) ?? { name: r.description, qty: 0, revenue: 0 };
      cur.qty += Number(r.quantity ?? 0);
      cur.revenue += Number(r.line_total ?? 0);
      map.set(k, cur);
    }
    for (const r of topReturns as any[]) {
      const si = Array.isArray(r.sale_items) ? r.sale_items[0] : r.sale_items;
      const k = si?.product_id ?? si?.description;
      if (!k) continue;
      const cur = map.get(k);
      if (!cur) continue;
      cur.qty -= Number(r.quantity ?? 0);
      cur.revenue -= Number(r.refund_amount ?? 0);
    }
    return [...map.values()]
      .filter((v) => v.qty > 0 || v.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);
  }, [topRaw, topReturns]);

  // Resumen por método de pago del libro de ventas (solo completadas).
  const byMethod = useMemo(() => {
    const map = new Map<string, { method: string; tickets: number; total: number }>();
    for (const s of ledger) {
      if (s.status !== 'completada') continue;
      const cur = map.get(s.payment_method) ?? {
        method: s.payment_method,
        tickets: 0,
        total: 0,
      };
      cur.tickets += 1;
      cur.total += Number(s.total ?? 0);
      map.set(s.payment_method, cur);
    }
    return [...map.values()];
  }, [ledger]);

  // KPIs desde v_sales_daily (vista canónica, ya NETEADA por devoluciones y sin
  // canceladas) en vez de sumar el ledger crudo — así el total/IVA del periodo
  // refleja ingresos reales, no el bruto con tickets cancelados/devueltos.
  const totalVentas = (daily as any[]).reduce((a, d) => a + Number(d.total ?? 0), 0);
  const totalIva = (daily as any[]).reduce((a, d) => a + Number(d.iva ?? 0), 0);
  const numVentas = (daily as any[]).reduce((a, d) => a + Number(d.ventas ?? 0), 0);

  const chartData = (daily as any[]).map((d) => ({
    dia: new Date(d.day).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
    }),
    total: fromCents(Number(d.total ?? 0)),
  }));

  // ── Datasets exportables ───────────────────────────────────────────────────
  const meta = (): ExportMetaLine[] => [
    { label: 'Negocio', value: business },
    { label: 'Periodo', value: `${period.from} a ${period.to}` },
    { label: 'Generado', value: new Date().toLocaleString('es-MX') },
  ];
  const fnameBase = `${period.from}_a_${period.to}`;

  const dailyDataset = (): ExportDataset => ({
    title: 'Ventas diarias',
    filename: `ventas-diarias-${fnameBase}`,
    meta: meta(),
    totals: true,
    rows: daily as any[],
    columns: [
      {
        header: 'Día',
        value: (r: any) => new Date(r.day).toLocaleDateString('es-MX'),
      },
      { header: '# Ventas', value: (r: any) => Number(r.ventas ?? 0), number: true },
      { header: 'IVA', value: (r: any) => Number(r.iva ?? 0), money: true },
      { header: 'Total', value: (r: any) => Number(r.total ?? 0), money: true },
    ],
  });

  const ledgerDataset = (): ExportDataset => ({
    title: 'Libro de ventas',
    filename: `libro-ventas-${fnameBase}`,
    meta: meta(),
    totals: true,
    // Excluye canceladas y totalmente devueltas (neto 0) del total del libro,
    // para que el renglón de totales concilie con los KPIs neteados.
    rows: ledger.filter(
      (s) => s.status !== 'cancelada' && s.status !== 'devuelta',
    ),
    columns: [
      { header: 'Folio', value: (r: Sale) => r.folio },
      {
        header: 'Fecha',
        value: (r: Sale) => new Date(r.created_at).toLocaleString('es-MX'),
      },
      {
        header: 'Método',
        value: (r: Sale) => METHOD_LABEL[r.payment_method] ?? r.payment_method,
      },
      { header: 'Estatus', value: (r: Sale) => r.status },
      { header: 'Subtotal', value: (r: Sale) => Number(r.subtotal ?? 0), money: true },
      { header: 'IVA', value: (r: Sale) => Number(r.tax_total ?? 0), money: true },
      {
        header: 'Descuento',
        value: (r: Sale) => Number(r.discount_total ?? 0),
        money: true,
      },
      { header: 'Total', value: (r: Sale) => Number(r.total ?? 0), money: true },
    ],
  });

  const byMethodDataset = (): ExportDataset => ({
    title: 'Resumen por método de pago',
    filename: `metodos-pago-${fnameBase}`,
    meta: meta(),
    totals: true,
    rows: byMethod,
    columns: [
      {
        header: 'Método',
        value: (r: any) => METHOD_LABEL[r.method] ?? r.method,
      },
      { header: '# Tickets', value: (r: any) => r.tickets, number: true },
      { header: 'Total', value: (r: any) => r.total, money: true },
    ],
  });

  const topDataset = (): ExportDataset => ({
    title: 'Productos más vendidos',
    filename: `top-productos-${fnameBase}`,
    meta: meta(),
    totals: true,
    rows: top,
    columns: [
      { header: 'Producto', value: (r: any) => r.name },
      { header: 'Unidades', value: (r: any) => r.qty, number: true },
      { header: 'Ingreso', value: (r: any) => r.revenue, money: true },
    ],
  });

  const allDatasets = () => [
    ledgerDataset(),
    dailyDataset(),
    byMethodDataset(),
    topDataset(),
  ];

  return (
    <div className="page">
      <PageHeader
        title="Reportes"
        subtitle="Ventas y contabilidad por periodo"
        actions={
          <ExportMenu
            label="Exportar todo"
            getDatasets={allDatasets}
            filename={`reporte-ventas-${fnameBase}`}
            business={business}
          />
        }
      />

      <div className="mb-lg">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-3 mb-lg">
        <Kpi label="Ventas del periodo" value={formatMoney(totalVentas)} icon={TrendingUp} />
        <Kpi label="IVA del periodo" value={formatMoney(totalIva)} icon={CalendarDays} />
        <Kpi label="# tickets" value={String(numVentas)} icon={Receipt} />
      </div>

      <Card
        title="Ventas diarias"
        sub={`${period.from} a ${period.to}`}
        action={
          <ExportMenu
            size="sm"
            getDatasets={dailyDataset}
            business={business}
          />
        }
        style={{ marginBottom: 'var(--sp-lg, 20px)' }}
      >
        {chartData.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Sin datos" hint="No hay ventas en el periodo." />
        ) : (
          <AreaChart
            data={chartData}
            valueKey="total"
            labelKey="dia"
            height={260}
            yFormat={(v: number) =>
              '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0))
            }
          />
        )}
      </Card>

      <Card
        title="Resumen por método de pago"
        sub="Ventas completadas del periodo"
        action={
          <ExportMenu size="sm" getDatasets={byMethodDataset} business={business} />
        }
        padded={false}
        style={{ marginBottom: 'var(--sp-lg, 20px)' }}
      >
        {byMethod.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin ventas" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Método</th>
                <th style={{ textAlign: 'right' }}># Tickets</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {byMethod.map((m) => (
                <tr key={m.method}>
                  <td className="fw-500">{METHOD_LABEL[m.method] ?? m.method}</td>
                  <td className="num text-2 tnum">{m.tickets}</td>
                  <td className="num fw-600">{formatMoney(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Libro de ventas"
        sub={`${ledger.length} tickets en el periodo`}
        action={
          <ExportMenu size="sm" getDatasets={ledgerDataset} business={business} />
        }
        padded={false}
        style={{ marginBottom: 'var(--sp-lg, 20px)' }}
      >
        {ledger.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin ventas" hint="No hay tickets en el periodo." />
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Fecha</th>
                  <th>Método</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {ledger.slice(0, 200).map((s) => (
                  <tr key={s.folio}>
                    <td className="fw-500 mono">{s.folio}</td>
                    <td className="text-2">
                      {new Date(s.created_at).toLocaleString('es-MX')}
                    </td>
                    <td className="text-2">
                      {METHOD_LABEL[s.payment_method] ?? s.payment_method}
                    </td>
                    <td className="num fw-600">{formatMoney(Number(s.total ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ledger.length > 200 && (
              <p className="text-3 text-xs" style={{ padding: '8px 12px' }}>
                Mostrando 200 de {ledger.length}. Exporta para ver todos.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Productos más vendidos"
        sub="Por ingreso en el periodo"
        action={<ExportMenu size="sm" getDatasets={topDataset} business={business} />}
        padded={false}
      >
        {top.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin ventas" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Producto</th>
                <th style={{ textAlign: 'right' }}>Unidades</th>
                <th style={{ textAlign: 'right' }}>Ingreso</th>
              </tr>
            </thead>
            <tbody>
              {top.slice(0, 10).map((t, i) => (
                <tr key={i}>
                  <td className="fw-500">{t.name}</td>
                  <td className="num text-2 tnum">{t.qty}</td>
                  <td className="num fw-600">{formatMoney(t.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
