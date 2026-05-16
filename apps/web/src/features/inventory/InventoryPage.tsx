import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDownUp } from 'lucide-react';
import { useActiveSucursal } from '@/lib/useActiveSucursal';
import { supabase } from '@/lib/supabase';

interface StockRow {
  product_id: string;
  stock: number;
  products: { name: string; sku: string; min_stock: number } | null;
}
type MovKind = 'entrada' | 'salida' | 'ajuste' | 'merma';

export default function InventoryPage() {
  const sucursalId = useActiveSucursal();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [mov, setMov] = useState<{
    productId: string;
    name: string;
    kind: MovKind;
    qty: string;
    reason: string;
  } | null>(null);
  const [kardexFor, setKardexFor] = useState<string | null>(null);

  const { data: stock = [], isLoading } = useQuery({
    queryKey: ['stock', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<StockRow[]> => {
      const { data, error } = await supabase
        .from('branch_stock')
        .select('product_id, stock, products(name, sku, min_stock)')
        .eq('sucursal_id', sucursalId!)
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as StockRow[];
    },
  });

  const { data: kardex = [] } = useQuery({
    queryKey: ['kardex', kardexFor],
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
    mutationFn: async (m: NonNullable<typeof mov>) => {
      const q = Number(m.qty);
      if (!q || q <= 0) throw new Error('Cantidad inválida');
      // entrada/ajuste(+) suma; salida/merma resta.
      const signed =
        m.kind === 'entrada' || (m.kind === 'ajuste')
          ? Math.abs(q)
          : -Math.abs(q);
      const { error } = await supabase.from('inventory_movements').insert({
        sucursal_id: sucursalId,
        product_id: m.productId,
        kind: m.kind,
        quantity: signed,
        ref_type: m.reason || m.kind,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Movimiento aplicado');
      setMov(null);
      void qc.invalidateQueries({ queryKey: ['stock'] });
      void qc.invalidateQueries({ queryKey: ['kardex'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const filtered = useMemo(() => {
    const term2 = term.trim().toLowerCase();
    const rows = stock.filter((s) => s.products);
    if (!term2) return rows;
    return rows.filter(
      (s) =>
        s.products!.name.toLowerCase().includes(term2) ||
        s.products!.sku.toLowerCase().includes(term2),
    );
  }, [term, stock]);

  const lowCount = stock.filter(
    (s) => s.products && s.stock <= (s.products.min_stock ?? 0),
  ).length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Inventario</h1>
        {lowCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1 text-sm text-amber-600">
            <AlertTriangle size={14} /> {lowCount} con bajo stock
          </span>
        )}
      </div>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Buscar producto…"
        className="mb-4 w-full rounded-lg border p-3 dark:bg-slate-800"
      />

      {isLoading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Producto</th>
              <th className="p-2">Stock</th>
              <th className="p-2">Mínimo</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const low = s.stock <= (s.products!.min_stock ?? 0);
              return (
                <tr key={s.product_id} className="border-t dark:border-slate-800">
                  <td className="p-2 font-medium">{s.products!.name}</td>
                  <td className={`p-2 ${low ? 'text-amber-600' : ''}`}>
                    {s.stock}
                  </td>
                  <td className="p-2 text-slate-400">
                    {s.products!.min_stock}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => setKardexFor(s.product_id)}
                      className="mr-3 text-slate-400"
                      title="Kardex"
                    >
                      ☰
                    </button>
                    <button
                      onClick={() =>
                        setMov({
                          productId: s.product_id,
                          name: s.products!.name,
                          kind: 'entrada',
                          qty: '',
                          reason: '',
                        })
                      }
                      className="text-brand"
                      title="Movimiento"
                    >
                      <ArrowDownUp size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {mov && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 dark:bg-slate-900">
            <h2 className="text-lg font-bold">Movimiento: {mov.name}</h2>
            <select
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              value={mov.kind}
              onChange={(e) =>
                setMov({ ...mov, kind: e.target.value as MovKind })
              }
            >
              <option value="entrada">Entrada (+)</option>
              <option value="salida">Salida (−)</option>
              <option value="ajuste">Ajuste (+)</option>
              <option value="merma">Merma (−)</option>
            </select>
            <input
              type="number"
              autoFocus
              placeholder="Cantidad"
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              value={mov.qty}
              onChange={(e) => setMov({ ...mov, qty: e.target.value })}
            />
            <input
              placeholder="Motivo / referencia"
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              value={mov.reason}
              onChange={(e) => setMov({ ...mov, reason: e.target.value })}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMov(null)}
                className="btn-touch flex-1 border dark:border-slate-700"
              >
                Cancelar
              </button>
              <button
                disabled={applyMov.isPending}
                onClick={() => applyMov.mutate(mov)}
                className="btn-touch flex-1 bg-brand text-white"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {kardexFor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-2 rounded-2xl bg-white p-6 dark:bg-slate-900">
            <div className="flex items-center">
              <h2 className="text-lg font-bold">Kardex</h2>
              <button
                onClick={() => setKardexFor(null)}
                className="ml-auto text-slate-400"
              >
                Cerrar
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto text-sm">
              {kardex.map((k: any, i) => (
                <div
                  key={i}
                  className="flex justify-between border-b py-1 dark:border-slate-800"
                >
                  <span>{new Date(k.created_at).toLocaleString()}</span>
                  <span className="capitalize">{k.kind}</span>
                  <span
                    className={
                      k.quantity < 0 ? 'text-red-500' : 'text-green-600'
                    }
                  >
                    {k.quantity > 0 ? '+' : ''}
                    {k.quantity}
                  </span>
                </div>
              ))}
              {kardex.length === 0 && (
                <p className="py-4 text-center text-slate-400">
                  Sin movimientos
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
