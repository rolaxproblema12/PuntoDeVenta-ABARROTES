import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, Users, History } from 'lucide-react';
import { USER_ROLES, type UserRole } from '@abarrotes/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageHeader, Card, Badge, EmptyState } from '@/components/ui';

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
    <div className="page">
      <PageHeader
        title="Usuarios y Seguridad"
        subtitle={`${users.length} usuarios · roles, PIN y bitácora`}
      />

      <Card
        title={
          <span className="flex items-center gap-sm">
            <KeyRound size={14} /> Mi PIN (acciones críticas)
          </span>
        }
        sub="Requerido para confirmar operaciones sensibles."
      >
        <div className="flex gap-sm">
          <input
            type="password"
            inputMode="numeric"
            placeholder="Nuevo PIN (4-6 dígitos)"
            className="field"
            style={{ flex: 1 }}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button
            onClick={() => savePin.mutate()}
            className="btn primary"
          >
            <KeyRound size={13} /> Guardar
          </button>
        </div>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-sm">
            <Users size={14} /> Usuarios del negocio
          </span>
        }
        sub={
          !isAdmin ? 'Solo el administrador puede cambiar roles.' : undefined
        }
        padded={false}
      >
        <div className="tbl-card" style={{ border: 'none' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Activo</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u.id}>
                  <td className="fw-500" data-label="Nombre">{u.full_name || '—'}</td>
                  <td className="muted mono text-xs" data-label="Correo">{u.email}</td>
                  <td data-label="Rol">
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
                      className="field"
                    >
                      {USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Activo">
                    {u.active ? (
                      <Badge tone="pos" dot>
                        activo
                      </Badge>
                    ) : (
                      <Badge tone="neg" dot>
                        inactivo
                      </Badge>
                    )}
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
                      style={{ marginLeft: 8 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-sm">
            <History size={14} /> Bitácora reciente
          </span>
        }
      >
        {log.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Sin actividad"
            hint="Las acciones del equipo aparecerán aquí."
          />
        ) : (
          <div className="feed" style={{ maxHeight: 256, overflowY: 'auto' }}>
            {log.map((l: any, i) => (
              <div key={i} className="feed-item">
                <div className="feed-icon">
                  <History size={13} />
                </div>
                <div className="feed-bd">
                  <span className="fw-500">{l.action_key}</span>
                  <span className="text-3 text-sm">{l.entity ?? ''}</span>
                </div>
                <span className="feed-when">
                  {new Date(l.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
