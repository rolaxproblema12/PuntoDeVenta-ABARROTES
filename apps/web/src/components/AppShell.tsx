import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Moon, ShieldAlert, Sun } from 'lucide-react';
import { ROLE_RANK } from '@abarrotes/shared';
import { MENU } from '@/lib/menu';
import { useTheme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { SyncIndicator } from './SyncIndicator';

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, isPlatformAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const role = profile?.role ?? 'cajero';
  const items = MENU.filter((m) => ROLE_RANK[role] >= ROLE_RANK[m.minRole]);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 flex-col border-r bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="p-4 text-lg font-bold">🛒 ABARROTES POS</div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2">
          {items.map((m) => (
            <NavLink
              key={m.path}
              to={m.path}
              className={({ isActive }) =>
                `flex min-h-touch items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                  isActive
                    ? 'bg-brand text-white'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`
              }
            >
              <m.icon size={18} />
              {m.label}
            </NavLink>
          ))}
          {isPlatformAdmin && (
            <NavLink
              to="/admin/platform"
              className={({ isActive }) =>
                `flex min-h-touch items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                  isActive
                    ? 'bg-amber-600 text-white'
                    : 'text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`
              }
            >
              <ShieldAlert size={18} />
              Plataforma
            </NavLink>
          )}
        </nav>
        <div className="border-t p-3 text-xs text-slate-500 dark:border-slate-800">
          {profile?.full_name} · {role}
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b px-4 py-3 dark:border-slate-800">
          <SyncIndicator />
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggle}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Cambiar tema"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                nav('/login');
              }}
              className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Salir"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}
