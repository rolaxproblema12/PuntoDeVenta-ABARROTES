import { useState } from 'react';
import { toast } from 'sonner';
import { formatMoney, type PlanCode } from '@abarrotes/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/apiClient';

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
      <div className="mx-auto max-w-lg p-6">
        <h1 className="text-2xl font-bold">Facturación</h1>
        <p className="mt-2 text-slate-500">Sin tenant asociado.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-bold">Facturación</h1>
      <div className="rounded-xl border p-4 dark:border-slate-800">
        <p className="text-sm text-slate-500">Negocio</p>
        <p className="font-semibold">{tenant.name}</p>
        <p className="mt-2 text-sm text-slate-500">Plan</p>
        <p className="font-semibold capitalize">{tenant.plan_code}</p>
        <p className="mt-2 text-sm text-slate-500">Estado</p>
        <p className="font-semibold capitalize">{tenant.status}</p>
        {tenant.trial_ends_at && (
          <p className="mt-2 text-xs text-slate-400">
            Prueba hasta {new Date(tenant.trial_ends_at).toLocaleDateString()}
          </p>
        )}
      </div>

      <button
        disabled={busy}
        onClick={() =>
          go('/billing/checkout', {
            plan_code: tenant.plan_code as PlanCode,
          })
        }
        className="btn-touch w-full bg-brand text-white hover:bg-brand-dark"
      >
        {busy ? 'Redirigiendo…' : 'Suscribirme / Cambiar plan'}
      </button>
      <button
        disabled={busy}
        onClick={() => go('/billing/portal')}
        className="btn-touch w-full border dark:border-slate-700"
      >
        Gestionar método de pago
      </button>
      <p className="text-xs text-slate-400">
        Pagos seguros con Stripe. Precios desde {formatMoney(49900)} / mes.
      </p>
    </div>
  );
}
