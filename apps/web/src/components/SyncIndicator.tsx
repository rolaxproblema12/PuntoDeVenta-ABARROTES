import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { subscribeQueue, type SyncOp } from '@/lib/syncQueue';

export function SyncIndicator() {
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

  const pending = ops.filter((o) => o.status !== 'applied').length;

  if (online && pending === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-1 text-sm text-amber-600 dark:text-amber-400">
      {online ? <RefreshCw size={16} /> : <CloudOff size={16} />}
      {online ? `${pending} venta(s) por sincronizar` : 'Sin conexión'}
    </div>
  );
}
