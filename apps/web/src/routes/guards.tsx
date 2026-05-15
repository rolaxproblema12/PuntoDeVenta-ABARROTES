import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  ROLE_RANK,
  TENANT_ACTIVE_STATUSES,
  type UserRole,
} from '@abarrotes/shared';
import { useAuth } from '@/features/auth/AuthProvider';

/** Dos puertas: sesión válida + profile.active (espejo del sistema base). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-slate-400">
        Cargando…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (!profile?.active) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <p>
          Tu cuenta está inactiva. Solicita activación a un administrador.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Gate de suscripción: si el tenant está suspendido / cancelado / trial
 * expirado, bloquea la app y manda a la página de facturación.
 * Platform-admin no tiene tenant → no se le aplica.
 */
export function BillingGate({ children }: { children: ReactNode }) {
  const { tenant, isPlatformAdmin } = useAuth();
  if (isPlatformAdmin) return <>{children}</>;
  if (!tenant) return <>{children}</>;

  const trialExpired =
    tenant.status === 'trial' &&
    tenant.trial_ends_at != null &&
    new Date(tenant.trial_ends_at) < new Date();
  const blocked =
    !TENANT_ACTIVE_STATUSES.includes(tenant.status) || trialExpired;

  if (blocked) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-2xl font-bold">Suscripción inactiva</h1>
          <p className="text-slate-500">
            Tu prueba terminó o el pago no está al día. Reactiva tu plan para
            seguir vendiendo.
          </p>
          <a
            href="/billing"
            className="btn-touch inline-block bg-brand px-6 text-white"
          >
            Ir a facturación
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Solo el dueño de la plataforma (super-admin). */
export function PlatformAdminRoute({ children }: { children: ReactNode }) {
  const { isPlatformAdmin } = useAuth();
  if (!isPlatformAdmin) return <Navigate to="/pos" replace />;
  return <>{children}</>;
}

/** Restringe una ruta a un rol mínimo. */
export function RoleRoute({
  minRole,
  children,
}: {
  minRole: UserRole;
  children: ReactNode;
}) {
  const { profile } = useAuth();
  if (!profile || ROLE_RANK[profile.role] < ROLE_RANK[minRole]) {
    return <Navigate to="/pos" replace />;
  }
  return <>{children}</>;
}
