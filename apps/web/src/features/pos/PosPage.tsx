import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { v7 as uuidv7 } from 'uuid';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import {
  formatMoney,
  type CartLine,
  type CreateSaleInput,
} from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { api, ApiRequestError } from '@/lib/apiClient';
import { enqueueOp, drainQueue } from '@/lib/syncQueue';
import { useCart, useRegister, useSucursal } from '@/lib/stores';

interface ProductRow {
  id: string;
  name: string;
  base_unit: string;
  tax_rate: number;
  product_prices: { price: number; cost: number }[];
  product_barcodes: { barcode: string }[];
}

export default function PosPage() {
  const { sucursalId } = useSucursal();
  const { registerId, cashSessionId } = useRegister();
  const cart = useCart();
  const [term, setTerm] = useState('');

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
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <section className="flex flex-col">
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Escanea código de barras o busca por nombre…"
          className="mb-3 w-full rounded-xl border p-4 text-lg dark:bg-slate-800"
        />
        <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              className="btn-touch flex-col items-start bg-white p-3 text-left shadow hover:ring-2 hover:ring-brand dark:bg-slate-900"
            >
              <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
              <span className="mt-1 text-brand">
                {formatMoney(p.product_prices?.[0]?.price ?? 0)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <aside className="flex flex-col rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-2 text-lg font-bold">Ticket</h2>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {cart.lines.map((l, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800"
            >
              <span className="flex-1">
                {l.quantity}× {l.description}
              </span>
              <span>{formatMoney(l.unitPrice * l.quantity)}</span>
              <button
                onClick={() => cart.remove(i)}
                className="ml-2 text-red-500"
                aria-label="Quitar"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {cart.lines.length === 0 && (
            <p className="py-8 text-center text-slate-400">Ticket vacío</p>
          )}
        </div>
        <div className="mt-3 border-t pt-3">
          <div className="mb-3 flex justify-between text-2xl font-bold">
            <span>Total</span>
            <span>{formatMoney(cart.totalCents())}</span>
          </div>
          <button
            onClick={checkout}
            className="btn-touch w-full bg-green-600 text-white hover:bg-green-700"
          >
            Cobrar (efectivo)
          </button>
        </div>
      </aside>
    </div>
  );
}
