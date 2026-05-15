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
} from 'lucide-react';
import type { UserRole } from '@abarrotes/shared';

export interface MenuItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Rol mínimo para ver el módulo. */
  minRole: UserRole;
}

/** Los 10 módulos. El sidebar filtra por rol. */
export const MENU: MenuItem[] = [
  { path: '/pos', label: 'Caja (POS)', icon: ShoppingCart, minRole: 'cajero' },
  { path: '/inventory', label: 'Inventario', icon: Boxes, minRole: 'encargado' },
  { path: '/products', label: 'Productos', icon: Package, minRole: 'encargado' },
  { path: '/customers', label: 'Clientes', icon: CreditCard, minRole: 'cajero' },
  { path: '/purchasing', label: 'Compras', icon: Truck, minRole: 'encargado' },
  { path: '/reports', label: 'Reportes', icon: LineChart, minRole: 'supervisor' },
  { path: '/sucursales', label: 'Sucursales', icon: Store, minRole: 'administrador' },
  { path: '/security', label: 'Seguridad', icon: ShieldCheck, minRole: 'administrador' },
  { path: '/smart', label: 'Inteligencia', icon: Sparkles, minRole: 'supervisor' },
  { path: '/cloud', label: 'Nube / Sync', icon: Cloud, minRole: 'encargado' },
  { path: '/cash', label: 'Cortes de caja', icon: Banknote, minRole: 'cajero' },
];
