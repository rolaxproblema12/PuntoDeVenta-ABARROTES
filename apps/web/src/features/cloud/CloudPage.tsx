import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Cloud, RefreshCw } from 'lucide-react';
import { drainQueue, subscribeQueue, type SyncOp } from '@/lib/syncQueue';

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
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Cloud /> Nube y Sincronización
      </h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Conexión" value={online ? 'En línea' : 'Sin conexión'} />
        <Stat label="Pendientes" value={String(pending.length)} />
        <Stat label="Conflictos" value={String(conflicts.length)} />
        <Stat label="Fallidas" value={String(failed.length)} />
      </div>

      <button
        onClick={async () => {
          await drainQueue();
          toast.success('Sincronización ejecutada');
        }}
        disabled={!online || pending.length === 0}
        className="btn-touch bg-brand px-4 text-white disabled:opacity-50"
      >
        <RefreshCw size={16} /> Sincronizar ahora
      </button>

      <div className="rounded-xl border p-4 dark:border-slate-800">
        <h2 className="mb-2 font-bold">Operaciones en cola</h2>
        {ops.length === 0 ? (
          <p className="py-4 text-center text-slate-400">
            Todo sincronizado. Las ventas hechas sin internet aparecerán aquí
            hasta reconectar.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="p-2">Tipo</th>
                <th className="p-2">Estado</th>
                <th className="p-2">Creada</th>
                <th className="p-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o) => (
                <tr
                  key={o.clientOpId}
                  className="border-t dark:border-slate-800"
                >
                  <td className="p-2">{o.type}</td>
                  <td
                    className={`p-2 ${
                      o.status === 'conflict' || o.status === 'failed'
                        ? 'text-red-500'
                        : 'text-amber-600'
                    }`}
                  >
                    {o.status}
                  </td>
                  <td className="p-2 text-slate-400">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                  <td className="p-2 text-slate-400">{o.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-400">
        La base de datos vive en Supabase (nube) con respaldos automáticos. Las
        ventas offline se reintentan de forma idempotente al reconectar.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4 dark:border-slate-800">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
