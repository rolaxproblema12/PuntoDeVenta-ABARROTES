import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Truck, X } from 'lucide-react';
import { toCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';

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

export default function PurchasingPage() {
  const sucursalId = useActiveSucursal();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'suppliers' | 'receive'>('suppliers');
  const [supForm, setSupForm] = useState<Partial<Supplier> | null>(null);
  const [lines, setLines] = useState<ReceiptLine[]>([
    { product_id: '', qty: '', unit_cost: '' },
  ]);

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
        (l) => l.product_id && Number(l.qty) > 0,
      );
      if (valid.length === 0) throw new Error('Agrega al menos una línea');
      for (const l of valid) {
        const { error } = await supabase.from('inventory_movements').insert({
          sucursal_id: sucursalId,
          product_id: l.product_id,
          kind: 'entrada',
          quantity: Math.abs(Number(l.qty)),
          unit_cost: toCents(Number(l.unit_cost) || 0),
          ref_type: 'compra',
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Mercancía recibida — stock actualizado');
      setLines([{ product_id: '', qty: '', unit_cost: '' }]);
      void qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-4 text-2xl font-bold">Compras y Proveedores</h1>
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('suppliers')}
          className={`btn-touch px-4 ${tab === 'suppliers' ? 'bg-brand text-white' : 'border dark:border-slate-700'}`}
        >
          Proveedores
        </button>
        <button
          onClick={() => setTab('receive')}
          className={`btn-touch px-4 ${tab === 'receive' ? 'bg-brand text-white' : 'border dark:border-slate-700'}`}
        >
          <Truck size={16} /> Recibir mercancía
        </button>
      </div>

      {tab === 'suppliers' && (
        <>
          <button
            onClick={() => setSupForm({ active: true })}
            className="btn-touch mb-3 bg-brand px-4 text-white"
          >
            <Plus size={18} /> Nuevo proveedor
          </button>
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="p-2">Proveedor</th>
                <th className="p-2">Contacto</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-t dark:border-slate-800">
                  <td className="p-2 font-medium">{s.name}</td>
                  <td className="p-2 text-slate-400">{s.contact ?? '—'}</td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => setSupForm({ ...s })}
                      className="text-brand"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-slate-400">
                    Sin proveedores.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {tab === 'receive' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Cada línea suma stock al producto y registra su costo.
          </p>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_110px_32px] gap-2">
              <select
                className="rounded-lg border p-2 dark:bg-slate-800"
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
                className="rounded-lg border p-2 dark:bg-slate-800"
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
                className="rounded-lg border p-2 dark:bg-slate-800"
                value={l.unit_cost}
                onChange={(e) => {
                  const n = [...lines];
                  n[i] = { ...l, unit_cost: e.target.value };
                  setLines(n);
                }}
              />
              <button
                onClick={() =>
                  setLines(lines.filter((_, idx) => idx !== i))
                }
                className="text-red-500"
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              setLines([...lines, { product_id: '', qty: '', unit_cost: '' }])
            }
            className="text-sm text-brand"
          >
            + Agregar línea
          </button>
          <button
            disabled={receive.isPending}
            onClick={() => receive.mutate()}
            className="btn-touch w-full bg-green-600 text-white"
          >
            {receive.isPending ? 'Recibiendo…' : 'Confirmar recepción'}
          </button>
        </div>
      )}

      {supForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 dark:bg-slate-900">
            <div className="flex items-center">
              <h2 className="text-lg font-bold">
                {supForm.id ? 'Editar' : 'Nuevo'} proveedor
              </h2>
              <button
                onClick={() => setSupForm(null)}
                className="ml-auto text-slate-400"
              >
                <X size={20} />
              </button>
            </div>
            <input
              autoFocus
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              placeholder="Nombre"
              value={supForm.name ?? ''}
              onChange={(e) =>
                setSupForm({ ...supForm, name: e.target.value })
              }
            />
            <input
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              placeholder="Contacto (tel/correo)"
              value={supForm.contact ?? ''}
              onChange={(e) =>
                setSupForm({ ...supForm, contact: e.target.value })
              }
            />
            <button
              disabled={saveSupplier.isPending || !supForm.name?.trim()}
              onClick={() => saveSupplier.mutate(supForm)}
              className="btn-touch w-full bg-brand text-white"
            >
              {saveSupplier.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
