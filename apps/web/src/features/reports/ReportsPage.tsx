import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, fromCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';

export default function ReportsPage() {
  const sucursalId = useActiveSucursal();

  const { data: daily = [] } = useQuery({
    queryKey: ['rep-daily', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('v_sales_daily')
        .select('day, ventas, total, iva')
        .eq('sucursal_id', sucursalId!)
        .order('day', { ascending: false })
        .limit(14);
      return (data ?? []).reverse();
    },
  });

  const { data: top = [] } = useQuery({
    queryKey: ['rep-top', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('v_top_products')
        .select('name, qty_sold, revenue')
        .eq('sucursal_id', sucursalId!)
        .order('revenue', { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const totalVentas = daily.reduce(
    (a: number, d: any) => a + Number(d.total ?? 0),
    0,
  );
  const numVentas = daily.reduce(
    (a: number, d: any) => a + Number(d.ventas ?? 0),
    0,
  );
  const hoy = daily[daily.length - 1] as any;

  const chartData = daily.map((d: any) => ({
    dia: new Date(d.day).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
    }),
    total: fromCents(Number(d.total ?? 0)),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Reportes</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Kpi label="Ventas hoy" value={formatMoney(Number(hoy?.total ?? 0))} />
        <Kpi label="Ventas (14 días)" value={formatMoney(totalVentas)} />
        <Kpi label="# tickets (14 días)" value={String(numVentas)} />
      </div>

      <div className="rounded-xl border p-4 dark:border-slate-800">
        <h2 className="mb-3 font-bold">Ventas diarias (14 días)</h2>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="dia" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip
                formatter={(v: number) => formatMoney(Math.round(v * 100))}
              />
              <Bar dataKey="total" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border p-4 dark:border-slate-800">
        <h2 className="mb-3 font-bold">Productos más vendidos</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Producto</th>
              <th className="p-2">Unidades</th>
              <th className="p-2">Ingreso</th>
            </tr>
          </thead>
          <tbody>
            {top.map((t: any, i) => (
              <tr key={i} className="border-t dark:border-slate-800">
                <td className="p-2 font-medium">{t.name}</td>
                <td className="p-2">{t.qty_sold}</td>
                <td className="p-2">{formatMoney(Number(t.revenue ?? 0))}</td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-slate-400">
                  Aún no hay ventas registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4 dark:border-slate-800">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
