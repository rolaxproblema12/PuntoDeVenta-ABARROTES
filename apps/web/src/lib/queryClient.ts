import { QueryClient } from '@tanstack/react-query';
import { get, set, del } from 'idb-keyval';
import {
  persistQueryClient,
  type Persister,
} from '@tanstack/react-query-persist-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 1000 * 60 * 30,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Persiste el caché de lectura en IndexedDB (soporte offline de lectura). */
const idbPersister: Persister = {
  persistClient: (client) => set('abarrotes-rq-cache', client),
  restoreClient: () => get('abarrotes-rq-cache'),
  removeClient: () => del('abarrotes-rq-cache'),
};

export function initPersistence(): void {
  persistQueryClient({
    queryClient,
    persister: idbPersister,
    maxAge: 1000 * 60 * 60 * 24,
    dehydrateOptions: {
      // No persistir búsquedas dinámicas (se rehacen online).
      shouldDehydrateQuery: (q) => !String(q.queryKey[0]).startsWith('search'),
    },
  });
}
