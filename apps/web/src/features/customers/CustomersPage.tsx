import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HandCoins, Pencil, Plus, X } from 'lucide-react';
import { formatMoney, fromCents, toCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number;
  current_balance: number;
  active: boolean;
}

export default function CustomersPage() {
  const sucursalId = useActiveSucursal();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [form, setForm] = useState<Partial<Customer> & { _new?: boolean } | null>(
    null,
  );
  const [abono, setAbono] = useState<{ c: Customer; amount: string } | null>(
    null,
  );

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers', sucursalId],
    enabled: !!sucursalId,
    queryFn: async (): Promise<Customer[]> => {
      const { data, error } = await supabase
        .from('customers')
        .select('id,name,phone,credit_limit,current_balance,active')
        .eq('sucursal_id', sucursalId!)
        .order('name')
        .limit(1000);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (c: Partial<Customer>) => {
      const payload = {
        sucursal_id: sucursalId,
        name: (c.name ?? '').trim(),
        phone: c.phone || null,
        credit_limit: c.credit_limit ?? 0,
        active: c.active ?? true,
      };
      if (c.id) {
        const { error } = await supabase
          .from('customers')
          .update(payload)
          .eq('id', c.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('customers').insert(payload);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Cliente guardado');
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const doAbono = useMutation({
    mutationFn: async (a: NonNullable<typeof abono>) => {
      const cents = toCents(Number(a.amount) || 0);
      if (cents <= 0) throw new Error('Monto inválido');
      const { error } = await supabase
        .from('customer_credit_movements')
        .insert({
          customer_id: a.c.id,
          sucursal_id: sucursalId,
          kind: 'abono',
          amount: cents,
          note: 'Abono en mostrador',
        });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Abono registrado');
      setAbono(null);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q),
    );
  }, [term, customers]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Clientes</h1>
        <button
          onClick={() => setForm({ _new: true, active: true, credit_limit: 0 })}
          className="btn-touch ml-auto bg-brand px-4 text-white"
        >
          <Plus size={18} /> Nuevo
        </button>
      </div>
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Buscar por nombre o teléfono…"
        className="mb-4 w-full rounded-lg border p-3 dark:bg-slate-800"
      />

      {isLoading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Cliente</th>
              <th className="p-2">Teléfono</th>
              <th className="p-2">Saldo</th>
              <th className="p-2">Límite</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-t dark:border-slate-800">
                <td className="p-2 font-medium">{c.name}</td>
                <td className="p-2 text-slate-400">{c.phone ?? '—'}</td>
                <td
                  className={`p-2 ${c.current_balance > 0 ? 'text-amber-600' : ''}`}
                >
                  {formatMoney(c.current_balance)}
                </td>
                <td className="p-2 text-slate-400">
                  {formatMoney(c.credit_limit)}
                </td>
                <td className="p-2 text-right">
                  <button
                    onClick={() => setAbono({ c, amount: '' })}
                    className="mr-3 text-green-600"
                    title="Registrar abono"
                  >
                    <HandCoins size={16} />
                  </button>
                  <button
                    onClick={() => setForm({ ...c })}
                    className="text-brand"
                  >
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-slate-400">
                  Sin clientes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {form && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 dark:bg-slate-900">
            <div className="flex items-center">
              <h2 className="text-lg font-bold">
                {form.id ? 'Editar' : 'Nuevo'} cliente
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
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              placeholder="Teléfono"
              value={form.phone ?? ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <label className="block text-sm">
              Límite de crédito ($)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border p-3 dark:bg-slate-800"
                value={
                  form.credit_limit != null ? fromCents(form.credit_limit) : ''
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    credit_limit: toCents(Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <button
              disabled={save.isPending || !form.name?.trim()}
              onClick={() => save.mutate(form)}
              className="btn-touch w-full bg-brand text-white"
            >
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {abono && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 dark:bg-slate-900">
            <h2 className="text-lg font-bold">Abono · {abono.c.name}</h2>
            <p className="text-sm text-slate-500">
              Saldo actual: {formatMoney(abono.c.current_balance)}
            </p>
            <input
              type="number"
              autoFocus
              placeholder="Monto del abono ($)"
              className="w-full rounded-lg border p-3 dark:bg-slate-800"
              value={abono.amount}
              onChange={(e) => setAbono({ ...abono, amount: e.target.value })}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setAbono(null)}
                className="btn-touch flex-1 border dark:border-slate-700"
              >
                Cancelar
              </button>
              <button
                disabled={doAbono.isPending}
                onClick={() => doAbono.mutate(abono)}
                className="btn-touch flex-1 bg-green-600 text-white"
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
