import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatMoney } from '@abarrotes/shared';
import { api } from '@/lib/apiClient';
import { PageHeader, Kpi, Badge } from '@/components/ui';

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
    <div className="page">
      <PageHeader
        title="Plataforma"
        subtitle="Panel del super-admin · negocios y métricas"
      />

      <div className="grid grid-4 mb-lg">
        <Kpi label="Tenants" value={String(metrics?.total ?? '—')} />
        <Kpi
          label="Activos"
          value={String(metrics?.byStatus?.active ?? 0)}
        />
        <Kpi label="Trial" value={String(metrics?.byStatus?.trial ?? 0)} />
        <Kpi
          label="MRR"
          value={metrics ? formatMoney(metrics.mrrCents) : '—'}
        />
      </div>

      {isLoading ? (
        <p className="text-3">Cargando…</p>
      ) : (
        <div className="tbl-card">
          <table className="tbl">
            <thead>
              <tr>
                <th>Negocio</th>
                <th>Plan</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td className="fw-500">{t.name}</td>
                  <td>
                    <Badge tone="accent">{t.plan_code}</Badge>
                  </td>
                  <td>
                    <Badge
                      tone={
                        t.status === 'suspended' || t.status === 'canceled'
                          ? 'neg'
                          : t.status === 'trial'
                            ? 'warn'
                            : 'pos'
                      }
                      dot
                    >
                      {t.status}
                    </Badge>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {t.status === 'suspended' || t.status === 'canceled' ? (
                      <button
                        onClick={() => act(t.id, 'reactivate')}
                        className="btn primary sm"
                      >
                        Reactivar
                      </button>
                    ) : (
                      <button
                        onClick={() => act(t.id, 'suspend')}
                        className="btn sm"
                      >
                        Suspender
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
