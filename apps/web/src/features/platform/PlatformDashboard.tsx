import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatMoney } from '@abarrotes/shared';
import { api } from '@/lib/apiClient';

interface TenantRow {
  id: string;
  name: string;
  status: string;
  plan_code: string;
  created_at: string;
}
interface Metrics {
  total: number;
  byStatus: Record<string, number>;
  mrrCents: number;
}

/** Panel del dueño de la plataforma (super-admin). */
export default function PlatformDashboard() {
  const qc = useQueryClient();

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: () => api<TenantRow[]>('/platform/tenants'),
  });
  const { data: metrics } = useQuery({
    queryKey: ['platform', 'metrics'],
    queryFn: () => api<Metrics>('/platform/metrics'),
  });

  async function act(id: string, action: 'suspend' | 'reactivate') {
    try {
      await api(`/platform/tenants/${id}/${action}`, { method: 'POST' });
      toast.success(action === 'suspend' ? 'Tenant suspendido' : 'Tenant reactivado');
      void qc.invalidateQueries({ queryKey: ['platform'] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Plataforma</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Tenants" value={String(metrics?.total ?? '—')} />
        <Stat label="Activos" value={String(metrics?.byStatus?.active ?? 0)} />
        <Stat label="Trial" value={String(metrics?.byStatus?.trial ?? 0)} />
        <Stat
          label="MRR"
          value={metrics ? formatMoney(metrics.mrrCents) : '—'}
        />
      </div>

      {isLoading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Negocio</th>
              <th className="p-2">Plan</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t dark:border-slate-800">
                <td className="p-2 font-medium">{t.name}</td>
                <td className="p-2 capitalize">{t.plan_code}</td>
                <td className="p-2 capitalize">{t.status}</td>
                <td className="p-2">
                  {t.status === 'suspended' || t.status === 'canceled' ? (
                    <button
                      onClick={() => act(t.id, 'reactivate')}
                      className="rounded bg-green-600 px-3 py-1 text-white"
                    >
                      Reactivar
                    </button>
                  ) : (
                    <button
                      onClick={() => act(t.id, 'suspend')}
                      className="rounded bg-red-600 px-3 py-1 text-white"
                    >
                      Suspender
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4 dark:border-slate-800">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
