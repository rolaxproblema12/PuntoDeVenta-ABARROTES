import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useActiveSucursal } from '@/lib/useActiveSucursal';
import { useRegister } from '@/lib/stores';

interface OpenSession {
  id: string;
  register_id: string;
  opened_at: string;
}

/**
 * Resuelve la sesión de caja ABIERTA en el servidor para la sucursal activa y
 * reconcilia el store local (`useRegister`). Así cualquier dispositivo del mismo
 * usuario ve la misma caja abierta —y sus ventas/movimientos/corte— sin depender
 * del `registerId` que ese dispositivo tuviera guardado en localStorage. También
 * corrige el caso inverso: si la caja se cerró en otro dispositivo, limpia el
 * `cashSessionId` local obsoleto.
 *
 * Modelo: una caja abierta compartida por sucursal (en producción hay 1 caja por
 * sucursal — ver `provision_tenant`). Si hubiera varias sesiones abiertas, adopta
 * la más reciente de forma determinística.
 *
 * Polling de 20 s + refetch al enfocar la ventana: un open/close hecho en otro
 * dispositivo se refleja en pocos segundos sin necesidad de Realtime. El
 * dispositivo que abre/cierra no espera al polling porque invalida este query.
 */
export function useActiveCashSession() {
  const sucursalId = useActiveSucursal();
  const { registerId, cashSessionId, setRegister, setCashSession } =
    useRegister();

  const query = useQuery({
    queryKey: ['open-cash-session', sucursalId],
    enabled: !!sucursalId,
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<OpenSession[]> => {
      const { data, error } = await supabase
        .from('cash_sessions')
        .select('id, register_id, opened_at')
        .eq('sucursal_id', sucursalId!)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as OpenSession[];
    },
  });

  const { isSuccess, data } = query;

  // Reconciliación: solo tras una carga exitosa (evita parpadear a "cerrada"
  // mientras carga/offline). Cada rama escribe al store SOLO si cambia, así el
  // efecto converge a no-op y no genera loops (el queryKey no depende del store).
  useEffect(() => {
    if (!isSuccess || !data) return;
    // Caja objetivo: la ya elegida si sigue abierta; si no, la más reciente
    // abierta en la sucursal (data viene ordenada por opened_at desc).
    const target =
      data.find((s) => s.register_id === registerId) ?? data[0];

    if (target) {
      if (target.id !== cashSessionId) setCashSession(target.id);
      if (target.register_id !== registerId) setRegister(target.register_id);
    } else if (cashSessionId !== null) {
      // Ya no hay caja abierta en el servidor (se cerró en otro dispositivo).
      setCashSession(null);
    }
  }, [isSuccess, data, registerId, cashSessionId, setRegister, setCashSession]);

  return query;
}
