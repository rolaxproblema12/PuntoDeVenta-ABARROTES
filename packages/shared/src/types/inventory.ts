import type { MovementKind, TransferStatus } from '../enums.js';
import type { AuditFields, UUID } from './common.js';

export interface Lot {
  id: UUID;
  product_id: UUID;
  sucursal_id: UUID;
  lot_code: string;
  qty_received: number;
  qty_remaining: number;
  /** Centavos. */
  cost: number;
  expiry_date: string | null;
  received_at: string;
}

export interface BranchStock {
  product_id: UUID;
  sucursal_id: UUID;
  stock: number;
  /** Centavos. */
  avg_cost: number;
  updated_at: string;
}

export interface InventoryMovement extends AuditFields {
  id: UUID;
  sucursal_id: UUID;
  product_id: UUID;
  lot_id: UUID | null;
  kind: MovementKind;
  /** Cantidad con signo (negativa = salida). */
  quantity: number;
  /** Centavos. */
  unit_cost: number;
  ref_type: string | null;
  ref_id: UUID | null;
}

export interface Transfer extends AuditFields {
  id: UUID;
  from_sucursal_id: UUID;
  to_sucursal_id: UUID;
  status: TransferStatus;
  notes: string | null;
}

export interface TransferItem {
  id: UUID;
  transfer_id: UUID;
  product_id: UUID;
  quantity: number;
}
