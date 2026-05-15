import { lazy, Suspense } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import type { UserRole } from '@abarrotes/shared';
import { AuthProvider } from '@/features/auth/AuthProvider';
import {
  AuthGate,
  BillingGate,
  PlatformAdminRoute,
  RoleRoute,
} from '@/routes/guards';
import { AppShell } from '@/components/AppShell';
import { ModulePage } from '@/features/_placeholder/ModulePage';

const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const BillingPage = lazy(() => import('@/features/billing/BillingPage'));
const PlatformDashboard = lazy(
  () => import('@/features/platform/PlatformDashboard'),
);
const PosPage = lazy(() => import('@/features/pos/PosPage'));
const CashPage = lazy(() => import('@/features/cash/CashPage'));

interface Skeleton {
  path: string;
  title: string;
  phase: number;
  minRole: UserRole;
  features: string[];
}

const SKELETONS: Skeleton[] = [
  {
    path: '/inventory',
    title: 'Inventario Inteligente',
    phase: 1,
    minRole: 'encargado',
    features: [
      'Stock en tiempo real por sucursal',
      'Lotes y caducidades',
      'Ajustes y mermas',
      'Traspasos entre sucursales',
      'Kardex / historial',
      'Alertas de bajo inventario',
    ],
  },
  {
    path: '/products',
    title: 'Gestión de Productos',
    phase: 1,
    minRole: 'encargado',
    features: [
      'Categorías y marcas',
      'Códigos de barras y packs',
      'Listas de precios / mayoreo',
      'Variantes y combos',
      'Productos restringidos por edad',
      'Promociones programadas',
    ],
  },
  {
    path: '/customers',
    title: 'Clientes y Créditos',
    phase: 2,
    minRole: 'cajero',
    features: [
      'Registro de clientes',
      'Crédito y abonos',
      'Estado de cuenta',
      'Límites de crédito',
      'Puntos / lealtad',
      'Clientes frecuentes',
    ],
  },
  {
    path: '/purchasing',
    title: 'Compras y Proveedores',
    phase: 2,
    minRole: 'encargado',
    features: [
      'Órdenes de compra',
      'Recepción de mercancía',
      'Costos históricos',
      'Cuentas por pagar',
      'Proveedores frecuentes',
      'Lotes desde recepción',
    ],
  },
  {
    path: '/reports',
    title: 'Reportes y Analítica',
    phase: 3,
    minRole: 'supervisor',
    features: [
      'Dashboard con gráficas',
      'Ventas diarias/semanales/mensuales',
      'Productos más/menos vendidos',
      'Utilidad por producto',
      'Comparativa entre sucursales',
      'Exportar PDF / Excel',
    ],
  },
  {
    path: '/sucursales',
    title: 'Multi Sucursal',
    phase: 1,
    minRole: 'administrador',
    features: [
      'Administración centralizada',
      'Inventario independiente',
      'Usuarios por sucursal',
      'Dashboard central',
      'Transferencias',
      'Reportes globales',
    ],
  },
  {
    path: '/security',
    title: 'Usuarios y Seguridad',
    phase: 1,
    minRole: 'administrador',
    features: [
      'Roles y permisos avanzados',
      'Bitácora de actividad',
      'Validación por PIN',
      'Control de sesiones',
      'Códigos de acceso',
      'Recuperación de contraseña',
    ],
  },
  {
    path: '/smart',
    title: 'Funciones Inteligentes',
    phase: 4,
    minRole: 'supervisor',
    features: [
      'Detección de alta rotación',
      'Predicción de faltantes',
      'Recomendación de precios',
      'Búsqueda inteligente',
      'Dashboard ejecutivo',
      '(IA diferida — sin ML en v1)',
    ],
  },
  {
    path: '/cloud',
    title: 'Nube / Sincronización',
    phase: 1,
    minRole: 'encargado',
    features: [
      'Sincronización en tiempo real',
      'Cola offline + reintento',
      'Resolución de conflictos',
      'Backups automáticos',
      'Restauración',
      'Escalabilidad empresarial',
    ],
  },
];

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense
          fallback={
            <div className="grid min-h-screen place-items-center text-slate-400">
              Cargando…
            </div>
          }
        >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/billing"
              element={
                <AuthGate>
                  <AppShell>
                    <BillingPage />
                  </AppShell>
                </AuthGate>
              }
            />
            <Route
              path="/admin/platform"
              element={
                <AuthGate>
                  <PlatformAdminRoute>
                    <AppShell>
                      <PlatformDashboard />
                    </AppShell>
                  </PlatformAdminRoute>
                </AuthGate>
              }
            />
            <Route
              path="/*"
              element={
                <AuthGate>
                  <BillingGate>
                    <AppShell>
                      <Routes>
                      <Route path="/" element={<Navigate to="/pos" replace />} />
                      <Route path="/pos" element={<PosPage />} />
                      <Route path="/cash" element={<CashPage />} />
                      {SKELETONS.map((s) => (
                        <Route
                          key={s.path}
                          path={s.path}
                          element={
                            <RoleRoute minRole={s.minRole}>
                              <ModulePage
                                title={s.title}
                                phase={s.phase}
                                features={s.features}
                              />
                            </RoleRoute>
                          }
                        />
                      ))}
                      <Route path="*" element={<Navigate to="/pos" replace />} />
                      </Routes>
                    </AppShell>
                  </BillingGate>
                </AuthGate>
              }
            />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
