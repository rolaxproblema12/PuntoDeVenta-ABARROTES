import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Store } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

function genCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default function SucursalesPage() {
  const { tenant } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');

  const { data: sucursales = [], isLoading } = useQuery({
    queryKey: ['sucursales-admin', tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sucursales')
        .select('id, code, name, address, active')
        .eq('tenant_id', tenant!.id)
        .order('name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (n: string) => {
      const { error } = await supabase.from('sucursales').insert({
        tenant_id: tenant!.id,
        code: genCode(),
        name: n.trim(),
      });
      if (error) {
        if (error.message.includes('PLAN_LIMIT')) {
          throw new Error(
            'Alcanzaste el límite de sucursales de tu plan. Mejora tu plan en Facturación.',
          );
        }
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success('Sucursal creada');
      setName('');
      void qc.invalidateQueries({ queryKey: ['sucursales-admin'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Sucursales</h1>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la nueva sucursal"
          className="flex-1 rounded-lg border p-3 dark:bg-slate-800"
        />
        <button
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate(name)}
          className="btn-touch bg-brand px-4 text-white"
        >
          <Plus size={18} /> Crear
        </button>
      </div>

      {isLoading ? (
        <p className="text-slate-400">Cargando…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sucursales.map((s: any) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl border p-4 dark:border-slate-800"
            >
              <Store className="text-brand" />
              <div>
                <p className="font-semibold">{s.name}</p>
                <p className="text-xs text-slate-400">
                  {s.code} {s.address ? `· ${s.address}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">
        El número de sucursales depende de tu plan (se valida en el servidor).
      </p>
    </div>
  );
}
