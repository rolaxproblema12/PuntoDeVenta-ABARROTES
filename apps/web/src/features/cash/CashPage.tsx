import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatMoney, toCents } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/apiClient';
import { useRegister, useSucursal } from '@/lib/stores';
import { useAuth } from '@/features/auth/AuthProvider';

export default function CashPage() {
  const { profile } = useAuth();
  const { sucursalId, setSucursal } = useSucursal();
  const { registerId, setRegister, cashSessionId, setCashSession } =
    useRegister();
  const [opening, setOpening] = useState('0');

  useEffect(() => {
    if (!sucursalId && profile?.default_sucursal_id) {
      setSucursal(profile.default_sucursal_id);
    }
  }, [profile, sucursalId, setSucursal]);

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn: async () => {
      const { data } = await supabase.from('sucursales').select('id,name,code');
      return data ?? [];
    },
  });

  const { data: registers = [] } = useQuery({
    queryKey: ['registers', sucursalId],
    enabled: !!sucursalId,
    queryFn: async () => {
      const { data } = await supabase
        .from('registers')
        .select('id,name')
        .eq('sucursal_id', sucursalId!);
      return data ?? [];
    },
  });

  async function openSession() {
    if (!sucursalId || !registerId) {
      toast.error('Selecciona sucursal y caja');
      return;
    }
    try {
      const res = await api<{ id: string }>('/cash/sessions', {
        method: 'POST',
        body: {
          sucursal_id: sucursalId,
          register_id: registerId,
          opening_amount: toCents(Number(opening) || 0),
        },
      });
      setCashSession(res.id);
      toast.success('Sesión de caja abierta');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function closeSession() {
    if (!cashSessionId) return;
    const counted = prompt('Efectivo contado (pesos):', '0');
    if (counted == null) return;
    try {
      const res = await api<{ difference: number }>(
        `/cash/sessions/${cashSessionId}/close`,
        {
          method: 'POST',
          body: { counted_cash: toCents(Number(counted) || 0) },
          pin: prompt('PIN de supervisor (cierre):') ?? undefined,
        },
      );
      setCashSession(null);
      toast.success(`Caja cerrada. Diferencia: ${formatMoney(res.difference)}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Caja / Cortes</h1>

      <label className="block text-sm">
        Sucursal
        <select
          value={sucursalId ?? ''}
          onChange={(e) => setSucursal(e.target.value)}
          className="mt-1 w-full rounded-lg border p-3 dark:bg-slate-800"
        >
          <option value="">— Selecciona —</option>
          {sucursales.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        Caja
        <select
          value={registerId ?? ''}
          onChange={(e) => setRegister(e.target.value)}
          className="mt-1 w-full rounded-lg border p-3 dark:bg-slate-800"
        >
          <option value="">— Selecciona —</option>
          {registers.map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      {cashSessionId ? (
        <div className="space-y-3 rounded-xl border p-4 dark:border-slate-800">
          <p className="text-green-600">● Sesión abierta</p>
          <button
            onClick={closeSession}
            className="btn-touch w-full bg-red-600 text-white"
          >
            Cerrar caja (corte)
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border p-4 dark:border-slate-800">
          <label className="block text-sm">
            Fondo de apertura (pesos)
            <input
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              type="number"
              className="mt-1 w-full rounded-lg border p-3 dark:bg-slate-800"
            />
          </label>
          <button
            onClick={openSession}
            className="btn-touch w-full bg-brand text-white"
          >
            Abrir sesión de caja
          </button>
        </div>
      )}
    </div>
  );
}
