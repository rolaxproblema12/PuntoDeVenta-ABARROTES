import type { BaseUnit, PriceListType, PromotionType } from '../enums.js';
import type { AuditFields, UUID } from './common.js';

export interface Category {
  id: UUID;
  sucursal_id: UUID | null;
  parent_id: UUID | null;
  name: string;
  sort: number;
}

export interface Brand {
  id: UUID;
  name: string;
}

export interface Product extends AuditFields {
  id: UUID;
  sucursal_id: UUID;
  sku: string;
  name: string;
  category_id: UUID | null;
  brand_id: UUID | null;
  base_unit: BaseUnit;
  is_weighed: boolean;
  age_restricted: boolean;
  tax_rate: number;
  sat_code: string | null;
  sat_unit: string | null;
  default_supplier_id: UUID | null;
  track_lots: boolean;
  track_expiry: boolean;
  min_stock: number;
  max_stock: number | null;
  active: boolean;
}

export interface ProductBarcode {
  id: UUID;
  product_id: UUID;
  barcode: string;
  pack_qty: number;
  unit_label: string;
}

export interface ProductVariant {
  id: UUID;
  product_id: UUID;
  name: string;
  sku: string | null;
  barcode: string | null;
  attributes: Record<string, unknown>;
}

export interface PriceList {
  id: UUID;
  sucursal_id: UUID;
  name: string;
  type: PriceListType;
  active: boolean;
}

export interface ProductPrice {
  id: UUID;
  product_id: UUID;
  price_list_id: UUID;
  variant_id: UUID | null;
  /** Centavos. */
  price: number;
  /** Centavos. */
  cost: number;
  min_qty: number;
}

export interface Promotion {
  id: UUID;
  sucursal_id: UUID;
  name: string;
  type: PromotionType;
  value: number;
  scope: 'product' | 'category' | 'all';
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  schedule: Record<string, unknown> | null;
}
