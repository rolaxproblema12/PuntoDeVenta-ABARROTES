import type { PurchaseOrderStatus } from '../enums.js';
import type { AuditFields, UUID } from './common.js';

export interface Supplier {
  id: UUID;
  sucursal_id: UUID;
  name: string;
  rfc: string | null;
  contact: string | null;
  terms_days: number;
  frequent: boolean;
  active: boolean;
}

export interface PurchaseOrder extends AuditFields {
  id: UUID;
  sucursal_id: UUID;
  folio: string;
  supplier_id: UUID;
  status: PurchaseOrderStatus;
  expected_at: string | null;
  /** Centavos. */
  total: number;
}

export interface PurchaseOrderItem {
  id: UUID;
  po_id: UUID;
  product_id: UUID;
  qty_ordered: number;
  qty_received: number;
  /** Centavos. */
  unit_cost: number;
}

export interface AccountPayable {
  id: UUID;
  sucursal_id: UUID;
  supplier_id: UUID;
  po_id: UUID | null;
  /** Centavos. */
  amount: number;
  /** Centavos. */
  paid: number;
  due_date: string | null;
  status: 'pendiente' | 'parcial' | 'pagada';
}
