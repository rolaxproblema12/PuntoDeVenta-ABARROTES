import { useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useSucursal } from '@/lib/stores';

/**
 * Sucursal activa para los módulos: la elegida en el store, o la sucursal
 * por defecto del perfil. La fija en el store si aún no hay ninguna.
 */
export function useActiveSucursal(): string | null {
  const { profile } = useAuth();
  const { sucursalId, setSucursal } = useSucursal();
  const resolved = sucursalId ?? profile?.default_sucursal_id ?? null;

  useEffect(() => {
    if (!sucursalId && profile?.default_sucursal_id) {
      setSucursal(profile.default_sucursal_id);
    }
  }, [sucursalId, profile?.default_sucursal_id, setSucursal]);

  return resolved;
}
