import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HandCoins, Pencil, Plus, Search } from 'lucide-react';
import { formatMoney, fromCents, toCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';
import { PageHeader, Modal, EmptyState } from '@/components/ui';

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
      if (cents > a.c.current_balance)
        throw new Error(
          `El abono (${formatMoney(cents)}) excede el saldo (${formatMoney(
            a.c.current_balance,
          )})`,
        );
      // RPC atómica: valida amount <= saldo con la fila bloqueada (no deja saldo
      // negativo). Ver register_credit_payment en 0025_accounting_hardening.sql.
      const { error } = await supabase.rpc('register_credit_payment', {
        p_payload: {
          customer_id: a.c.id,
          sucursal_id: sucursalId,
          amount: cents,
          note: 'Abono en mostrador',
        },
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
    <div className="page">
      <PageHeader
        title="Clientes"
        subtitle={`${customers.length} clientes registrados`}
        actions={
          <button
            onClick={() => setForm({ _new: true, active: true, credit_limit: 0 })}
            className="btn primary"
          >
            <Plus size={13} /> Nuevo
          </button>
        }
      />

      <div className="filters">
        <div className="search-input" style={{ minWidth: 320 }}>
          <Search size={13} />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por nombre o teléfono…"
          />
        </div>
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--text-3)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {filtered.length} resultados
        </span>
      </div>

      {isLoading ? (
        <p className="text-3">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Sin clientes"
            hint="Crea el primero con “Nuevo”."
            action={
              <button
                className="btn accent"
                onClick={() =>
                  setForm({ _new: true, active: true, credit_limit: 0 })
                }
              >
                <Plus size={13} /> Nuevo
              </button>
            }
          />
        </div>
      ) : (
        <div className="tbl-card">
          <table className="tbl">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th style={{ textAlign: 'right' }}>Límite</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td data-label="Cliente" className="fw-500">{c.name}</td>
                  <td data-label="Teléfono" className="muted">{c.phone ?? '—'}</td>
                  <td data-label="Saldo" className="num tnum">
                    <span
                      style={{
                        color:
                          c.current_balance > 0
                            ? 'var(--warn)'
                            : 'var(--text)',
                      }}
                    >
                      {formatMoney(c.current_balance)}
                    </span>
                  </td>
                  <td data-label="Límite" className="num tnum muted">
                    {formatMoney(c.credit_limit)}
                  </td>
                  <td data-label="" style={{ textAlign: 'right' }}>
                    <button
                      onClick={() => setAbono({ c, amount: '' })}
                      className="btn ghost sm"
                      title="Registrar abono"
                      aria-label="Registrar abono"
                    >
                      <HandCoins size={13} />
                    </button>
                    <button
                      onClick={() => setForm({ ...c })}
                      className="btn ghost sm"
                      aria-label="Editar"
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal
          title={`${form.id ? 'Editar' : 'Nuevo'} cliente`}
          onClose={() => setForm(null)}
          maxWidth={400}
          footer={
            <button
              disabled={save.isPending || !form.name?.trim()}
              onClick={() => save.mutate(form)}
              className="btn accent"
              style={{ width: '100%', height: 38, justifyContent: 'center' }}
            >
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          }
        >
          <div>
            <label className="label">Nombre</label>
            <input
              autoFocus
              className="field"
              placeholder="Nombre"
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input
              className="field"
              placeholder="Teléfono"
              value={form.phone ?? ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Límite de crédito ($)</label>
            <input
              type="number"
              className="field"
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
          </div>
        </Modal>
      )}

      {abono && (
        <Modal
          title={`Abono · ${abono.c.name}`}
          onClose={() => setAbono(null)}
          maxWidth={400}
          footer={
            <div className="flex gap-sm">
              <button
                onClick={() => setAbono(null)}
                className="btn"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Cancelar
              </button>
              <button
                disabled={
                  doAbono.isPending ||
                  toCents(Number(abono.amount) || 0) <= 0 ||
                  toCents(Number(abono.amount) || 0) > abono.c.current_balance
                }
                onClick={() => doAbono.mutate(abono)}
                className="btn accent"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {doAbono.isPending ? 'Registrando…' : 'Registrar'}
              </button>
            </div>
          }
        >
          <p className="text-sm text-3 mb-md">
            Saldo actual: {formatMoney(abono.c.current_balance)}
          </p>
          <div>
            <label className="label">Monto del abono ($)</label>
            <input
              type="number"
              autoFocus
              placeholder="Monto del abono ($)"
              className="field"
              value={abono.amount}
              onChange={(e) => setAbono({ ...abono, amount: e.target.value })}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
