import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { queryClient, initPersistence } from './lib/queryClient';
import { installSyncListeners } from './lib/syncQueue';
import { useTheme } from './lib/theme';
import './styles/index.css';

initPersistence();
installSyncListeners();
// Aplica el tema persistido al arrancar.
useTheme.getState();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  </StrictMode>,
);
