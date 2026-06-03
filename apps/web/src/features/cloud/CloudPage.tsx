import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Cloud, RefreshCw, ListChecks } from 'lucide-react';
import { drainQueue, subscribeQueue, type SyncOp } from '@/lib/syncQueue';
import {
  PageHeader,
  Card,
  Kpi,
  Badge,
  StatusDot,
  EmptyState,
} from '@/components/ui';

export default function CloudPage() {
  const [ops, setOps] = useState<SyncOp[]>([]);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const unsub = subscribeQueue(setOps);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      unsub();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const pending = ops.filter((o) => o.status === 'pending');
  const conflicts = ops.filter((o) => o.status === 'conflict');
  const failed = ops.filter((o) => o.status === 'failed');

  return (
    <div className="page">
      <PageHeader
        title="Nube y Sincronización"
        subtitle={
          <span className="flex items-center gap-sm">
            <Cloud size={13} /> Respaldo automático en Supabase · cola offline
            idempotente
          </span>
        }
        actions={
          <button
            onClick={async () => {
              await drainQueue();
              toast.success('Sincronización ejecutada');
            }}
            disabled={!online || pending.length === 0}
            className="btn primary"
          >
            <RefreshCw size={13} /> Sincronizar ahora
          </button>
        }
      />

      <div className="grid grid-4 mb-lg">
        <Kpi
          label="Conexión"
          value={
            <span className="flex items-center gap-sm">
              <StatusDot status={online ? 'ok' : 'offline'} />
              {online ? 'En línea' : 'Sin conexión'}
            </span>
          }
        />
        <Kpi label="Pendientes" value={String(pending.length)} />
        <Kpi label="Conflictos" value={String(conflicts.length)} />
        <Kpi label="Fallidas" value={String(failed.length)} />
      </div>

      <Card
        title={
          <span className="flex items-center gap-sm">
            <ListChecks size={14} /> Operaciones en cola
          </span>
        }
        padded={false}
      >
        {ops.length === 0 ? (
          <EmptyState
            icon={Cloud}
            title="Todo sincronizado"
            hint="Las ventas hechas sin internet aparecerán aquí hasta reconectar."
          />
        ) : (
          <div className="tbl-card" style={{ border: 'none' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Creada</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.clientOpId}>
                    <td className="fw-500">{o.type}</td>
                    <td>
                      <Badge
                        tone={
                          o.status === 'conflict' || o.status === 'failed'
                            ? 'neg'
                            : 'warn'
                        }
                        dot
                      >
                        {o.status}
                      </Badge>
                    </td>
                    <td className="muted text-xs">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                    <td className="muted text-xs">{o.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-3 text-xs mt-md">
        La base de datos vive en Supabase (nube) con respaldos automáticos. Las
        ventas offline se reintentan de forma idempotente al reconectar.
      </p>
    </div>
  );
}
