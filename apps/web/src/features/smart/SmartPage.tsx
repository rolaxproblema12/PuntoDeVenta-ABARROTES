import { useQuery } from '@tanstack/react-query';
import { Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { formatMoney } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';

/**
 * Inteligencia v1: heurísticas (sin ML). Recomendaciones de compra por bajo
 * stock, alta y baja rotación a partir de las vistas existentes.
 */
export default function SmartPage() {
  const sucursalId = useActiveSucursal();

  const { data: lowStock = [] } = useQuery({
    queryKey: ['smart-low', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('branch_stock')
        .select('stock, products(name, min_stock)')
        .eq('sucursal_id', sucursalId!)
        .limit(500);
      return (data ?? []).filter(
        (r: any) => r.products && r.stock <= (r.products.min_stock ?? 0),
      );
    },
  });

  const { data: top = [] } = useQuery({
    queryKey: ['smart-top', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('v_top_products')
        .select('name, qty_sold, revenue')
        .eq('sucursal_id', sucursalId!)
        .order('qty_sold', { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: slow = [] } = useQuery({
    queryKey: ['smart-slow', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('v_top_products')
        .select('name, qty_sold')
        .eq('sucursal_id', sucursalId!)
        .order('qty_sold', { ascending: true })
        .limit(5);
      return data ?? [];
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Sparkles className="text-brand" /> Inteligencia
      </h1>
      <p className="text-sm text-slate-500">
        Recomendaciones automáticas basadas en tus datos (heurísticas, sin
        costo de IA). Predicción avanzada llegará en una fase posterior.
      </p>

      <Card title="🛒 Recomendación de compra (bajo stock)">
        {lowStock.length === 0 ? (
          <Empty>Todo con stock suficiente.</Empty>
        ) : (
          lowStock.map((r: any, i: number) => (
            <Line key={i}>
              <span>{r.products.name}</span>
              <span className="text-amber-600">
                stock {r.stock} / mín {r.products.min_stock} → reabastecer
              </span>
            </Line>
          ))
        )}
      </Card>

      <Card title="🔥 Alta rotación">
        {top.length === 0 ? (
          <Empty>Sin ventas todavía.</Empty>
        ) : (
          top.map((t: any, i: number) => (
            <Line key={i}>
              <span className="flex items-center gap-2">
                <TrendingUp size={14} className="text-green-600" />
                {t.name}
              </span>
              <span className="text-slate-400">
                {t.qty_sold} u · {formatMoney(Number(t.revenue ?? 0))}
              </span>
            </Line>
          ))
        )}
      </Card>

      <Card title="🐌 Baja rotación (revisar precio/promoción)">
        {slow.length === 0 ? (
          <Empty>Sin datos.</Empty>
        ) : (
          slow.map((t: any, i: number) => (
            <Line key={i}>
              <span className="flex items-center gap-2">
                <TrendingDown size={14} className="text-red-500" />
                {t.name}
              </span>
              <span className="text-slate-400">{t.qty_sold} u</span>
            </Line>
          ))
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4 dark:border-slate-800">
      <h2 className="mb-2 font-bold">{title}</h2>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}
function Line({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b py-1 last:border-0 dark:border-slate-800">
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-center text-slate-400">{children}</p>;
}
