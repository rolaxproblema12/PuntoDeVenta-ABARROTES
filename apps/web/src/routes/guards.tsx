import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ROLE_RANK, type UserRole } from '@abarrotes/shared';
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
