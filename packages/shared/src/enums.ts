/**
 * Enumeraciones de dominio compartidas entre web y API.
 * Estos valores deben coincidir con los tipos/CHECKs definidos en supabase/migrations.
 */

export const USER_ROLES = ['cajero', 'encargado', 'supervisor', 'administrador'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Jerarquía de privilegios (mayor = más permisos). */
export const ROLE_RANK: Record<UserRole, number> = {
  cajero: 1,
  encargado: 2,
  supervisor: 3,
  administrador: 4,
};

export const BASE_UNITS = ['pieza', 'caja', 'paquete', 'peso'] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

export const PAYMENT_METHODS = [
  'efectivo',
  'tarjeta',
  'transferencia',
  'mixto',
  'credito',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SALE_STATUSES = ['completada', 'cancelada', 'devuelta'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_ITEM_KINDS = ['producto', 'combo', 'abono_credito'] as const;
export type SaleItemKind = (typeof SALE_ITEM_KINDS)[number];

export const MOVEMENT_KINDS = [
  'entrada',
  'salida',
  'ajuste',
  'transfer_in',
  'transfer_out',
  'venta',
  'devolucion',
  'merma',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const CASH_SESSION_STATUSES = ['open', 'closed'] as const;
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];

export const PRICE_LIST_TYPES = ['menudeo', 'mayoreo', 'especial'] as const;
export type PriceListType = (typeof PRICE_LIST_TYPES)[number];

export const PROMOTION_TYPES = ['pct', 'monto', '2x1', 'nxm', 'precio_fijo'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const TRANSFER_STATUSES = ['borrador', 'enviado', 'recibido', 'cancelado'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const PO_STATUSES = [
  'borrador',
  'enviada',
  'parcial',
  'recibida',
  'cancelada',
] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

export const CREDIT_MOVEMENT_KINDS = ['cargo', 'abono'] as const;
export type CreditMovementKind = (typeof CREDIT_MOVEMENT_KINDS)[number];

export const SYNC_OP_STATUSES = ['pending', 'applied', 'conflict', 'failed'] as const;
export type SyncOpStatus = (typeof SYNC_OP_STATUSES)[number];

export const SYNC_OP_TYPES = ['sale.create', 'sale.cancel', 'return.create'] as const;
export type SyncOpType = (typeof SYNC_OP_TYPES)[number];

/** Acciones que requieren validación por PIN (gateadas server-side). */
export const PIN_GATED_ACTIONS = [
  'sale.cancel',
  'return.create',
  'price.override',
  'cash.close_with_difference',
  'inventory.adjust',
  'credit.over_limit',
] as const;
export type PinGatedAction = (typeof PIN_GATED_ACTIONS)[number];

// ─── Capa SaaS multi-tenant ──────────────────────────────────────────────────

/** Estado del tenant (cliente que paga). Controla el acceso a la app. */
export const TENANT_STATUSES = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'canceled',
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Estados en los que el POS funciona con normalidad. */
export const TENANT_ACTIVE_STATUSES: readonly TenantStatus[] = [
  'trial',
  'active',
  'past_due',
];

export const PLAN_CODES = ['basico', 'pro', 'negocio'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/** Espejo de los estados de suscripción de Stripe que nos interesan. */
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const DEFAULT_TRIAL_DAYS = 14;
