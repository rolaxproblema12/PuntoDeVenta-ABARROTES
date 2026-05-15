import { useAuth } from '@/features/auth/AuthProvider';
import { formatMoney } from '@abarrotes/shared';

/**
 * Página de facturación. En SaaS-2 se conecta a Stripe (Checkout/Portal).
 * Hoy muestra el estado de la suscripción del tenant.
 */
export default function BillingPage() {
  const { tenant } = useAuth();
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
        disabled
        className="btn-touch w-full bg-brand text-white opacity-60"
        title="Disponible en SaaS-2"
      >
        Suscribirme / Gestionar pago (Stripe — próximamente)
      </button>
      <p className="text-xs text-slate-400">
        Precios desde {formatMoney(49900)} / mes.
      </p>
    </div>
  );
}
