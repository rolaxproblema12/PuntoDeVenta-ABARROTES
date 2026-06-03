import {
  Banknote,
  Boxes,
  Cloud,
  CreditCard,
  LineChart,
  type LucideIcon,
  Package,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Wallet,
} from 'lucide-react';
import type { UserRole } from '@abarrotes/shared';

export type MenuGroup =
  | 'Operación'
  | 'Catálogo'
  | 'Relaciones'
  | 'Análisis'
  | 'Sistema';

export interface MenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Grupo del sidebar (estilo Linear). */
  group: MenuGroup;
  /** Rol mínimo para ver el módulo. */
  minRole: UserRole;
}

/** Los 12 módulos, agrupados. El sidebar filtra por rol. */
export const MENU: MenuItem[] = [
  // Operación
  { path: '/pos', label: 'Caja (POS)', icon: ShoppingCart, group: 'Operación', minRole: 'cajero' },
  { path: '/cash', label: 'Corte de caja', icon: Banknote, group: 'Operación', minRole: 'cajero' },
  { path: '/sucursales', label: 'Sucursales', icon: Store, group: 'Operación', minRole: 'administrador' },
  // Catálogo
  { path: '/products', label: 'Productos', icon: Package, group: 'Catálogo', minRole: 'encargado' },
  { path: '/inventory', label: 'Inventario', icon: Boxes, group: 'Catálogo', minRole: 'encargado' },
  { path: '/purchasing', label: 'Compras', icon: Truck, group: 'Catálogo', minRole: 'encargado' },
  // Relaciones
  { path: '/customers', label: 'Clientes', icon: CreditCard, group: 'Relaciones', minRole: 'cajero' },
  // Análisis
  { path: '/reports', label: 'Reportes', icon: LineChart, group: 'Análisis', minRole: 'supervisor' },
  { path: '/billing', label: 'Facturación', icon: Wallet, group: 'Análisis', minRole: 'administrador' },
  // Sistema
  { path: '/smart', label: 'Inteligencia', icon: Sparkles, group: 'Sistema', minRole: 'supervisor' },
  { path: '/cloud', label: 'Nube / Sync', icon: Cloud, group: 'Sistema', minRole: 'encargado' },
  { path: '/security', label: 'Seguridad', icon: ShieldCheck, group: 'Sistema', minRole: 'administrador' },
];

export const MENU_GROUPS: MenuGroup[] = [
  'Operación',
  'Catálogo',
  'Relaciones',
  'Análisis',
  'Sistema',
];
