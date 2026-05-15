import type {
  BaseUnit,
  CashSessionStatus,
  PaymentMethod,
  SaleItemKind,
  SaleStatus,
} from '../enums';
import type { AuditFields, UUID } from './common';

export interface Register {
  id: UUID;
  sucursal_id: UUID;
  name: string;
  active: boolean;
}

export interface CashSession extends AuditFields {
  id: UUID;
  sucursal_id: UUID;
  register_id: UUID;
  status: CashSessionStatus;
  /** Centavos. */
  opening_amount: number;
  opened_by: UUID;
  opened_at: string;
  /** Centavos. */
  expected_cash: number | null;
  /** Centavos. */
  counted_cash: number | null;
  /** Centavos. */
  difference: number | null;
  closing_notes: string | null;
}

export interface Sale extends AuditFields {
  id: UUID;
  sucursal_id: UUID;
  folio: string;
  register_id: UUID;
  cash_session_id: UUID;
  customer_id: UUID | null;
  /** Todos los montos en centavos. */
  subtotal: number;
  tax_total: number;
  discount_total: number;
  tip: number;
  total: number;
  payment_method: PaymentMethod;
  status: SaleStatus;
  cancelled_at: string | null;
  cancelled_by: UUID | null;
  cancelled_reason: string | null;
}

export interface SaleItem {
  id: UUID;
  sale_id: UUID;
  sucursal_id: UUID;
  product_id: UUID | null;
  variant_id: UUID | null;
  lot_id: UUID | null;
  kind: SaleItemKind;
  description: string;
  quantity: number;
  unit: BaseUnit;
  /** Centavos. */
  unit_price: number;
  unit_cost: number;
  tax_rate: number;
  discount: number;
  line_total: number;
}

export interface SalePayment {
  id: UUID;
  sale_id: UUID;
  sucursal_id: UUID;
  method: PaymentMethod;
  /** Centavos. */
  amount: number;
  reference: string | null;
}

/** Línea de carrito en el cliente antes de persistir. */
export interface CartLine {
  productId: UUID;
  variantId: UUID | null;
  description: string;
  quantity: number;
  unit: BaseUnit;
  /** Centavos. */
  unitPrice: number;
  unitCost: number;
  taxRate: number;
  discount: number;
}
