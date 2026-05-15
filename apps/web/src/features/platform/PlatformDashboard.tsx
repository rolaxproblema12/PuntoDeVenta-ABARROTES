import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Panel del dueño de la plataforma (super-admin). Lista todos los tenants.
 * RLS permite a platform_admins ver todas las filas. Acciones de
 * suspender/reactivar y métricas/MRR llegan en SaaS-3 vía API /platform.
 */
export default function PlatformDashboard() {
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, name, slug, status, plan_code, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold">Plataforma · Tenants</h1>
      {isLoading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="p-2">Negocio</th>
              <th className="p-2">Plan</th>
              <th className="p-2">Estado</th>
              <th className="p-2">Alta</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t: any) => (
              <tr key={t.id} className="border-t dark:border-slate-800">
                <td className="p-2 font-medium">{t.name}</td>
                <td className="p-2 capitalize">{t.plan_code}</td>
                <td className="p-2 capitalize">{t.status}</td>
                <td className="p-2 text-slate-400">
                  {new Date(t.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-slate-400">
        Acciones (suspender/reactivar) y MRR en SaaS-3.
      </p>
    </div>
  );
}
