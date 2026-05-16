import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { USER_ROLES, type UserRole } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

export default function SecurityPage() {
  const { tenant, profile } = useAuth();
  const qc = useQueryClient();
  const [pin, setPin] = useState('');

  const { data: users = [] } = useQuery({
    queryKey: ['sec-users', tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, active')
        .eq('tenant_id', tenant!.id)
        .order('full_name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: log = [] } = useQuery({
    queryKey: ['sec-log', tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('activity_log')
        .select('action_key, entity, created_at')
        .order('created_at', { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const setRole = useMutation({
    mutationFn: async (p: { id: string; role: UserRole; active: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ role: p.role, active: p.active })
        .eq('id', p.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Usuario actualizado');
      void qc.invalidateQueries({ queryKey: ['sec-users'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const savePin = useMutation({
    mutationFn: async () => {
      if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN de 4 a 6 dígitos');
      const { error } = await supabase.rpc('set_pin', { p_pin: pin });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('PIN actualizado');
      setPin('');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const isAdmin = profile?.role === 'administrador';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Usuarios y Seguridad</h1>

      <div className="rounded-xl border p-4 dark:border-slate-800">
        <h2 className="mb-2 font-bold">Mi PIN (acciones críticas)</h2>
        <div className="flex gap-2">
          <input
            type="password"
            inputMode="numeric"
            placeholder="Nuevo PIN (4-6 dígitos)"
            className="flex-1 rounded-lg border p-3 dark:bg-slate-800"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button
            onClick={() => savePin.mutate()}
            className="btn-touch bg-brand px-4 text-white"
          >
            <KeyRound size={16} /> Guardar
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-4 dark:border-slate-800">
        <h2 className="mb-2 font-bold">Usuarios del negocio</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Nombre</th>
              <th className="p-2">Correo</th>
              <th className="p-2">Rol</th>
              <th className="p-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.id} className="border-t dark:border-slate-800">
                <td className="p-2">{u.full_name || '—'}</td>
                <td className="p-2 text-slate-400">{u.email}</td>
                <td className="p-2">
                  <select
                    disabled={!isAdmin || u.id === profile?.id}
                    value={u.role}
                    onChange={(e) =>
                      setRole.mutate({
                        id: u.id,
                        role: e.target.value as UserRole,
                        active: u.active,
                      })
                    }
                    className="rounded border p-1 dark:bg-slate-800"
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    type="checkbox"
                    disabled={!isAdmin || u.id === profile?.id}
                    checked={u.active}
                    onChange={(e) =>
                      setRole.mutate({
                        id: u.id,
                        role: u.role,
                        active: e.target.checked,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isAdmin && (
          <p className="mt-2 text-xs text-slate-400">
            Solo el administrador puede cambiar roles.
          </p>
        )}
      </div>

      <div className="rounded-xl border p-4 dark:border-slate-800">
        <h2 className="mb-2 font-bold">Bitácora reciente</h2>
        <div className="max-h-64 overflow-y-auto text-sm">
          {log.map((l: any, i) => (
            <div
              key={i}
              className="flex justify-between border-b py-1 dark:border-slate-800"
            >
              <span>{l.action_key}</span>
              <span className="text-slate-400">{l.entity ?? ''}</span>
              <span className="text-slate-400">
                {new Date(l.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {log.length === 0 && (
            <p className="py-4 text-center text-slate-400">Sin actividad.</p>
          )}
        </div>
      </div>
    </div>
  );
}
