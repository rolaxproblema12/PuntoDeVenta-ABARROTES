import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, X } from 'lucide-react';
import { formatMoney, fromCents, toCents, type BaseUnit } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';

interface Row {
  id: string;
  sku: string;
  name: string;
  base_unit: BaseUnit;
  tax_rate: number;
  active: boolean;
  category_id: string | null;
  product_prices: { price: number; cost: number; price_list_id: string }[];
  product_barcodes: { barcode: string }[];
}
interface FormState {
  id?: string;
  name: string;
  sku: string;
  category_id: string | null;
  base_unit: BaseUnit;
  tax_rate: number;
  price: string; // pesos
  cost: string;
  barcode: string;
  min_stock: string;
  active: boolean;
}

const empty: FormState = {
  name: '', sku: '', category_id: null, base_unit: 'pieza',
  tax_rate: 0.16, price: '', cost: '', barcode: '', min_stock: '0',
  active: true,
};

/** Asegura una lista de precios "Menudeo" para la sucursal y la devuelve. */
async function ensurePriceList(sucursalId: string): Promise<string> {
  const { data } = await supabase
    .from('price_lists')
    .select('id')
    .eq('sucursal_id', sucursalId)
    .eq('type', 'menudeo')
    .limit(1)
    .maybeSingle();
  if (data?.id) return data.id;
  const { data: created, error } = await supabase
    .from('price_lists')
    .insert({ sucursal_id: sucursalId, name: 'Menudeo', type: 'menudeo' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

export default function ProductsPage() {
  const sucursalId = useActiveSucursal();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [form, setForm] = useState<FormState | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name')
        .eq('sucursal_id', sucursalId!)
        .order('name');
      return data ?? [];
    },
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id,sku,name,base_unit,tax_rate,active,category_id,product_prices(price,cost,price_list_id),product_barcodes(barcode)',
        )
        .eq('sucursal_id', sucursalId!)
        .order('name')
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      if (!sucursalId) throw new Error('Sin sucursal');
      const payload = {
        sucursal_id: sucursalId,
        name: f.name.trim(),
        sku: f.sku.trim() || `SKU${Date.now()}`,
        category_id: f.category_id,
        base_unit: f.base_unit,
        tax_rate: f.tax_rate,
        min_stock: Number(f.min_stock) || 0,
        active: f.active,
      };
      let productId = f.id;
      if (productId) {
        const { error } = await supabase
          .from('products')
          .update(payload)
          .eq('id', productId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase
          .from('products')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        productId = data.id;
      }
      const priceListId = await ensurePriceList(sucursalId);
      const { error: pErr } = await supabase.from('product_prices').upsert(
        {
          product_id: productId,
          price_list_id: priceListId,
          price: toCents(Number(f.price) || 0),
          cost: toCents(Number(f.cost) || 0),
          min_qty: 1,
        },
        { onConflict: 'product_id,price_list_id,variant_id,min_qty' },
      );
      if (pErr) throw new Error(pErr.message);
      if (f.barcode.trim()) {
        await supabase
          .from('product_barcodes')
          .upsert(
            { product_id: productId, barcode: f.barcode.trim() },
            { onConflict: 'barcode' },
          );
      }
    },
    onSuccess: () => {
      toast.success('Producto guardado');
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.product_barcodes?.some((b) => b.barcode.includes(q)),
    );
  }, [term, products]);

  function openEdit(p: Row) {
    const pp = p.product_prices?.[0];
    setForm({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category_id: p.category_id,
      base_unit: p.base_unit,
      tax_rate: p.tax_rate,
      price: pp ? String(fromCents(pp.price)) : '',
      cost: pp ? String(fromCents(pp.cost)) : '',
      barcode: p.product_barcodes?.[0]?.barcode ?? '',
      min_stock: '0',
      active: p.active,
    });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Productos</h1>
        <button
          onClick={() => setForm({ ...empty })}
          className="btn-touch ml-auto bg-brand px-4 text-white"
        >
          <Plus size={18} /> Nuevo
        </button>
      </div>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Buscar por nombre, SKU o código…"
        className="mb-4 w-full rounded-lg border p-3 dark:bg-slate-800"
      />

      {isLoading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Producto</th>
              <th className="p-2">SKU</th>
              <th className="p-2">Precio</th>
              <th className="p-2">Costo</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t dark:border-slate-800">
                <td className="p-2 font-medium">
                  {p.name}
                  {!p.active && (
                    <span className="ml-2 text-xs text-red-500">inactivo</span>
                  )}
                </td>
                <td className="p-2 text-slate-400">{p.sku}</td>
                <td className="p-2">
                  {formatMoney(p.product_prices?.[0]?.price ?? 0)}
                </td>
                <td className="p-2 text-slate-400">
                  {formatMoney(p.product_prices?.[0]?.cost ?? 0)}
                </td>
                <td className="p-2 text-right">
                  <button onClick={() => openEdit(p)} className="text-brand">
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  Sin productos. Crea el primero con “Nuevo”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {form && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 dark:bg-slate-900">
            <div className="flex items-center">
              <h2 className="text-lg font-bold">
                {form.id ? 'Editar' : 'Nuevo'} producto
              </h2>
              <button
                onClick={() => setForm(null)}
                className="ml-auto text-slate-400"
              >
                <X size={20} />
              </button>
            </div>
            <input
              autoFocus
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              placeholder="Nombre"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="rounded-lg border p-3 dark:bg-slate-800"
                placeholder="SKU (opcional)"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
              <input
                className="rounded-lg border p-3 dark:bg-slate-800"
                placeholder="Código de barras"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </div>
            <select
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              value={form.category_id ?? ''}
              onChange={(e) =>
                setForm({ ...form, category_id: e.target.value || null })
              }
            >
              <option value="">— Sin categoría —</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                Precio venta ($)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border p-3 dark:bg-slate-800"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </label>
              <label className="text-sm">
                Costo ($)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border p-3 dark:bg-slate-800"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="rounded-lg border p-3 dark:bg-slate-800"
                value={form.base_unit}
                onChange={(e) =>
                  setForm({ ...form, base_unit: e.target.value as BaseUnit })
                }
              >
                <option value="pieza">Pieza</option>
                <option value="caja">Caja</option>
                <option value="paquete">Paquete</option>
                <option value="peso">Peso</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />
                Activo
              </label>
            </div>
            <button
              disabled={save.isPending || !form.name.trim()}
              onClick={() => save.mutate(form)}
              className="btn-touch w-full bg-brand text-white"
            >
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
