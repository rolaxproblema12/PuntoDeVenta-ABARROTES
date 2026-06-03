import { useQuery } from '@tanstack/react-query';
import {
  Sparkles,
  TrendingDown,
  TrendingUp,
  ShoppingCart,
  Flame,
  Snail,
} from 'lucide-react';
import { formatMoney } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';
import { PageHeader, Card, Badge, EmptyState } from '@/components/ui';

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
    <div className="page">
      <PageHeader
        title="Inteligencia"
        subtitle={
          <span className="flex items-center gap-sm">
            <Sparkles size={13} className="text-acc" /> Recomendaciones
            automáticas basadas en tus datos (heurísticas, sin costo de IA).
            Predicción avanzada llegará en una fase posterior.
          </span>
        }
      />

      <Card
        title={
          <span className="flex items-center gap-sm">
            <ShoppingCart size={14} /> Recomendación de compra (bajo stock)
          </span>
        }
      >
        {lowStock.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="Todo con stock suficiente."
          />
        ) : (
          <div className="feed">
            {lowStock.map((r: any, i: number) => (
              <div key={i} className="feed-item">
                <div className="feed-bd">
                  <span className="fw-500">{r.products.name}</span>
                </div>
                <Badge tone="warn" dot>
                  stock {r.stock} / mín {r.products.min_stock} → reabastecer
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={
          <span className="flex items-center gap-sm">
            <Flame size={14} /> Alta rotación
          </span>
        }
      >
        {top.length === 0 ? (
          <EmptyState icon={Flame} title="Sin ventas todavía." />
        ) : (
          <div className="feed">
            {top.map((t: any, i: number) => (
              <div key={i} className="feed-item">
                <div className="feed-icon">
                  <TrendingUp size={14} className="text-pos" />
                </div>
                <div className="feed-bd">
                  <span className="fw-500">{t.name}</span>
                </div>
                <span className="text-3 text-sm tnum">
                  {t.qty_sold} u · {formatMoney(Number(t.revenue ?? 0))}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={
          <span className="flex items-center gap-sm">
            <Snail size={14} /> Baja rotación (revisar precio/promoción)
          </span>
        }
      >
        {slow.length === 0 ? (
          <EmptyState icon={Snail} title="Sin datos." />
        ) : (
          <div className="feed">
            {slow.map((t: any, i: number) => (
              <div key={i} className="feed-item">
                <div className="feed-icon">
                  <TrendingDown size={14} className="text-neg" />
                </div>
                <div className="feed-bd">
                  <span className="fw-500">{t.name}</span>
                </div>
                <span className="text-3 text-sm tnum">{t.qty_sold} u</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
