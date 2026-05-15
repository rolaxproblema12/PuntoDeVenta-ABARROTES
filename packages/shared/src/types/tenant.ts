import type {
  PlanCode,
  SubscriptionStatus,
  TenantStatus,
} from '../enums';
import type { UUID } from './common';

/** Cliente que paga: posee N sucursales/usuarios. Aislado por RLS. */
export interface Tenant {
  id: UUID;
  name: string;
  slug: string;
  status: TenantStatus;
  plan_code: PlanCode;
  trial_ends_at: string | null;
  owner_user_id: UUID;
  created_at: string;
}

export interface Plan {
  code: PlanCode;
  name: string;
  /** Centavos. */
  price_cents: number;
  currency: string;
  max_sucursales: number;
  max_users: number;
  features: Record<string, unknown>;
  stripe_price_id: string | null;
}

export interface Subscription {
  tenant_id: UUID;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_code: PlanCode;
  status: SubscriptionStatus;
  current_period_end: string | null;
  trial_ends_at: string | null;
}

/** Dueño(s) de la plataforma (super-admin). */
export interface PlatformAdmin {
  user_id: UUID;
}

/** Contexto de tenant resuelto por la API en cada request. */
export interface TenantContext {
  id: UUID;
  status: TenantStatus;
  plan_code: PlanCode;
}
