import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Store } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  PageHeader,
  Card,
  Badge,
  StatusDot,
  EmptyState,
} from '@/components/ui';

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
    <div className="page">
      <PageHeader
        title="Sucursales"
        subtitle={`${sucursales.length} sucursales · administración multi-sucursal`}
      />

      <Card
        title="Nueva sucursal"
        sub="El número de sucursales depende de tu plan (se valida en el servidor)."
        style={{ marginBottom: 'var(--sp-lg, 20px)' }}
      >
        <div className="flex items-center gap-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la nueva sucursal"
            className="field"
            style={{ flex: 1 }}
          />
          <button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate(name)}
            className="btn primary"
          >
            <Plus size={13} /> Crear
          </button>
        </div>
      </Card>

      {isLoading ? (
        <p className="text-3">Cargando…</p>
      ) : sucursales.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Store}
            title="Sin sucursales"
            hint="Crea la primera con el formulario de arriba."
          />
        </div>
      ) : (
        <div className="grid grid-3">
          {sucursales.map((s: any) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between mb-sm">
                <div
                  className="flex items-center gap-sm"
                  style={{ minWidth: 0 }}
                >
                  <Store size={16} className="text-acc" />
                  <span
                    className="fw-600"
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.name}
                  </span>
                </div>
                <Badge tone={s.active ? 'pos' : 'neg'} dot>
                  {s.active ? 'Activa' : 'Inactiva'}
                </Badge>
              </div>
              <div className="flex items-center gap-sm text-sm text-3">
                <StatusDot status={s.active ? 'ok' : 'offline'} />
                <span className="mono">{s.code}</span>
                {s.address && <span>· {s.address}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
