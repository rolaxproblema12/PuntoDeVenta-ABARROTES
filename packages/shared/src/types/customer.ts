import type { CreditMovementKind } from '../enums';
import type { AuditFields, UUID } from './common';

export interface Customer extends AuditFields {
  id: UUID;
  sucursal_id: UUID;
  name: string;
  phone: string | null;
  email: string | null;
  rfc: string | null;
  /** Centavos. */
  credit_limit: number;
  /** Centavos. Saldo deudor actual. */
  current_balance: number;
  frequent: boolean;
  active: boolean;
}

export interface CustomerCreditMovement {
  id: UUID;
  customer_id: UUID;
  sucursal_id: UUID;
  kind: CreditMovementKind;
  /** Centavos. */
  amount: number;
  sale_id: UUID | null;
  /** Centavos. */
  balance_after: number;
  created_at: string;
  created_by: UUID | null;
}

export interface LoyaltyAccount {
  customer_id: UUID;
  sucursal_id: UUID;
  points_balance: number;
}
