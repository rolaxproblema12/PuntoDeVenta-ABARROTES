import { useEffect, useState, type ReactNode } from 'react';
import {
  NavLink,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  ShieldAlert,
  Sun,
} from 'lucide-react';
import { ROLE_RANK } from '@abarrotes/shared';
import { MENU, MENU_GROUPS } from '@/lib/menu';
import { useTheme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useRegister, useSucursal } from '@/lib/stores';
import { useAuth } from '@/features/auth/AuthProvider';
import { SyncIndicator } from './SyncIndicator';

const PLAN_LABEL: Record<string, string> = {
  trial: 'Prueba',
  basico: 'Plan Básico',
  pro: 'Plan Pro',
  enterprise: 'Plan Enterprise',
};

function initials(name: string | null | undefined, fallback = 'PV'): string {
  if (!name) return fallback;
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, tenant, isPlatformAdmin } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const role = profile?.role ?? 'cajero';
  const [navOpen, setNavOpen] = useState(false);
  // Cierra el cajón al navegar a otro módulo.
  useEffect(() => setNavOpen(false), [pathname]);

  const items = MENU.filter((m) => ROLE_RANK[role] >= ROLE_RANK[m.minRole]);
  const current =
    MENU.find((m) => pathname.startsWith(m.path))?.label ??
    (pathname.startsWith('/admin/platform') ? 'Plataforma' : 'Inicio');

  return (
    <div className="app">
      {navOpen && (
        <div className="sb-scrim" onClick={() => setNavOpen(false)} />
      )}
      <aside className={'sb' + (navOpen ? ' open' : '')}>
        <div className="sb-top">
          <span className="sb-logo">
            <span className="sb-logo-mark">a</span>
            <span>ABARROTES&nbsp;POS</span>
          </span>
        </div>

        <button
          className="sb-org"
          onClick={() => nav('/billing')}
          type="button"
        >
          <span className="sb-org-avatar">{initials(tenant?.name, 'AP')}</span>
          <span className="sb-org-info">
            <span className="sb-org-name">
              {tenant?.name ?? 'Mi negocio'}
            </span>
            <span className="sb-org-sub">
              {PLAN_LABEL[tenant?.plan_code ?? ''] ?? 'Plan activo'}
            </span>
          </span>
        </button>

        <div className="sb-scroll">
          {MENU_GROUPS.map((g) => {
            const groupItems = items.filter((m) => m.group === g);
            if (groupItems.length === 0) return null;
            return (
              <div key={g} className="sb-group">
                <div className="sb-group-label">{g}</div>
                <div className="sb-nav">
                  {groupItems.map((m) => (
                    <NavLink
                      key={m.path}
                      to={m.path}
                      className={({ isActive }) =>
                        'sb-item' + (isActive ? ' active' : '')
                      }
                    >
                      <m.icon className="sb-icon" />
                      <span style={{ flex: 1 }}>{m.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}

          {isPlatformAdmin && (
            <div className="sb-group">
              <div className="sb-group-label">Plataforma</div>
              <div className="sb-nav">
                <NavLink
                  to="/admin/platform"
                  className={({ isActive }) =>
                    'sb-item' + (isActive ? ' active' : '')
                  }
                  style={{ color: 'var(--warn)' }}
                >
                  <ShieldAlert className="sb-icon" />
                  <span style={{ flex: 1 }}>Super-admin</span>
                </NavLink>
              </div>
            </div>
          )}
        </div>

        <div className="sb-bottom">
          <span className="sb-bottom-avatar">
            {initials(profile?.full_name)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 500,
                fontSize: 12.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {profile?.full_name ?? 'Usuario'}
            </div>
            <div
              style={{
                color: 'var(--text-3)',
                fontSize: 11,
                textTransform: 'capitalize',
              }}
            >
              {role}
            </div>
          </div>
          <button
            className="btn ghost"
            style={{
              width: 26,
              height: 26,
              padding: 0,
              justifyContent: 'center',
            }}
            onClick={() => nav('/billing')}
            aria-label="Ajustes"
          >
            <Settings size={14} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="tb">
          <button
            className="tb-icon-btn tb-burger"
            onClick={() => setNavOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu size={16} />
          </button>
          <div className="tb-crumb">
            <span className="past">{tenant?.name ?? 'ABARROTES'}</span>
            <span className="sep">/</span>
            <span className="now">{current}</span>
          </div>

          <div className="tb-search" style={{ cursor: 'default' }}>
            <Search size={13} />
            <span>Buscar producto, cliente, ticket…</span>
            <span className="kbd">⌘K</span>
          </div>

          <SyncIndicator />

          <button
            onClick={toggle}
            className="tb-icon-btn"
            aria-label="Cambiar tema"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              // Evita que el siguiente usuario en este equipo herede la sucursal
              // y la caja del anterior: resetea memoria y storage persistido.
              useSucursal.setState({ sucursalId: null });
              useRegister.setState({ registerId: null, cashSessionId: null });
              useSucursal.persist.clearStorage();
              useRegister.persist.clearStorage();
              nav('/login');
            }}
            className="tb-icon-btn"
            aria-label="Salir"
          >
            <LogOut size={14} />
          </button>
        </header>

        <div className="content">{children}</div>
      </main>
    </div>
  );
}
