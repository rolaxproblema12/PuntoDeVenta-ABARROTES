import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  ROLE_RANK,
  TENANT_ACTIVE_STATUSES,
  type UserRole,
} from '@abarrotes/shared';
import { useAuth } from '@/features/auth/AuthProvider';

/** Pantalla centrada con marca para estados de bloqueo (estilo Linear). */
function GateScreen({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
        padding: 24,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 380,
          width: '100%',
          padding: 28,
          textAlign: 'center',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <span
          className="sb-logo-mark"
          style={{ width: 34, height: 34, fontSize: 18, margin: '0 auto 16px' }}
        >
          a
        </span>
        <h1
          style={{
            margin: '0 0 8px',
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </h1>
        <p
          className="text-2"
          style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.5 }}
        >
          {message}
        </p>
        {action && <div style={{ marginTop: 18 }}>{action}</div>}
      </div>
    </div>
  );
}

/** Dos puertas: sesión válida + profile.active (espejo del sistema base). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--bg)',
          color: 'var(--text-3)',
          fontSize: 'var(--text-sm)',
        }}
      >
        Cargando…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (!profile?.active) {
    return (
      <GateScreen
        title="Cuenta inactiva"
        message="Tu cuenta está inactiva. Solicita su activación a un administrador del negocio."
      />
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
      <GateScreen
        title="Suscripción inactiva"
        message="Tu prueba terminó o el pago no está al día. Reactiva tu plan para seguir vendiendo."
        action={
          <a href="/billing" className="btn accent" style={{ height: 38 }}>
            Ir a facturación
          </a>
        }
      />
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
