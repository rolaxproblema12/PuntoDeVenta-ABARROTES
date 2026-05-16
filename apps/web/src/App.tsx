import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { UserRole } from '@abarrotes/shared';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import {
  AuthGate,
  BillingGate,
  PlatformAdminRoute,
  RoleRoute,
} from '@/routes/guards';
import { AppShell } from '@/components/AppShell';

const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const LandingPage = lazy(() => import('@/features/marketing/LandingPage'));
const PricingPage = lazy(() => import('@/features/marketing/PricingPage'));
const SignupPage = lazy(() => import('@/features/marketing/SignupPage'));
const BillingPage = lazy(() => import('@/features/billing/BillingPage'));
const PlatformDashboard = lazy(
  () => import('@/features/platform/PlatformDashboard'),
);
const PosPage = lazy(() => import('@/features/pos/PosPage'));
const CashPage = lazy(() => import('@/features/cash/CashPage'));
const ProductsPage = lazy(() => import('@/features/products/ProductsPage'));
const InventoryPage = lazy(() => import('@/features/inventory/InventoryPage'));
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage'));
const PurchasingPage = lazy(
  () => import('@/features/purchasing/PurchasingPage'),
);
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const SucursalesPage = lazy(
  () => import('@/features/sucursales/SucursalesPage'),
);
const SecurityPage = lazy(() => import('@/features/security/SecurityPage'));
const CloudPage = lazy(() => import('@/features/cloud/CloudPage'));
const SmartPage = lazy(() => import('@/features/smart/SmartPage'));

/** Home pública: si ya hay sesión, entra al sistema. */
function PublicHome() {
  const { loading, session } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/pos" replace />;
  return <LandingPage />;
}

interface AppRoute {
  path: string;
  el: ReactNode;
  minRole?: UserRole;
}

const APP_ROUTES: AppRoute[] = [
  { path: '/pos', el: <PosPage /> },
  { path: '/cash', el: <CashPage /> },
  { path: '/products', el: <ProductsPage />, minRole: 'encargado' },
  { path: '/inventory', el: <InventoryPage />, minRole: 'encargado' },
  { path: '/customers', el: <CustomersPage /> },
  { path: '/purchasing', el: <PurchasingPage />, minRole: 'encargado' },
  { path: '/reports', el: <ReportsPage />, minRole: 'supervisor' },
  { path: '/sucursales', el: <SucursalesPage />, minRole: 'administrador' },
  { path: '/security', el: <SecurityPage />, minRole: 'administrador' },
  { path: '/smart', el: <SmartPage />, minRole: 'supervisor' },
  { path: '/cloud', el: <CloudPage />, minRole: 'encargado' },
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
            <Route path="/" element={<PublicHome />} />
            <Route path="/precios" element={<PricingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/registro" element={<SignupPage />} />
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
                        <Route
                          path="/"
                          element={<Navigate to="/pos" replace />}
                        />
                        {APP_ROUTES.map((r) => (
                          <Route
                            key={r.path}
                            path={r.path}
                            element={
                              r.minRole ? (
                                <RoleRoute minRole={r.minRole}>
                                  {r.el}
                                </RoleRoute>
                              ) : (
                                r.el
                              )
                            }
                          />
                        ))}
                        <Route
                          path="*"
                          element={<Navigate to="/pos" replace />}
                        />
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
