import { useState } from 'react';
import { toast } from 'sonner';
import { formatMoney, type PlanCode } from '@abarrotes/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/apiClient';
import { PageHeader, Card, Badge } from '@/components/ui';

/** Facturación: Stripe Checkout (suscribirse) y Billing Portal (gestionar). */
export default function BillingPage() {
  const { tenant } = useAuth();
  const [busy, setBusy] = useState(false);

  async function go(path: string, body?: unknown) {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>(path, {
        method: 'POST',
        body,
      });
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!tenant) {
    return (
      <div className="page">
        <PageHeader title="Facturación" subtitle="Sin tenant asociado." />
        <div className="card">
          <div className="card-bd" style={{ paddingTop: 16 }}>
            <p className="text-3">Sin tenant asociado.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Facturación"
        subtitle="Gestiona tu suscripción y método de pago"
      />

      <div style={{ maxWidth: 520 }}>
        <Card title="Suscripción" sub="Detalles de tu negocio y plan">
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div>
              <div className="label">Negocio</div>
              <div className="fw-600">{tenant.name}</div>
            </div>
            <div className="hr" style={{ margin: 0 }} />
            <div className="flex items-center justify-between">
              <div className="text-2 text-sm">Plan</div>
              <Badge tone="accent">{tenant.plan_code}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-2 text-sm">Estado</div>
              <Badge
                tone={tenant.status === 'active' ? 'pos' : 'warn'}
                dot
              >
                {tenant.status}
              </Badge>
            </div>
            {tenant.trial_ends_at && (
              <div className="text-3 text-xs">
                Prueba hasta{' '}
                {new Date(tenant.trial_ends_at).toLocaleDateString()}
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginTop: 18,
            }}
          >
            <button
              disabled={busy}
              onClick={() =>
                go('/billing/checkout', {
                  plan_code: tenant.plan_code as PlanCode,
                })
              }
              className="btn accent"
              style={{ width: '100%', height: 38, justifyContent: 'center' }}
            >
              {busy ? 'Redirigiendo…' : 'Suscribirme / Cambiar plan'}
            </button>
            <button
              disabled={busy}
              onClick={() => go('/billing/portal')}
              className="btn"
              style={{ width: '100%', height: 38, justifyContent: 'center' }}
            >
              Gestionar método de pago
            </button>
            <p className="text-3 text-xs" style={{ margin: '4px 0 0' }}>
              Pagos seguros con Stripe. Precios desde {formatMoney(49900)} /
              mes.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
