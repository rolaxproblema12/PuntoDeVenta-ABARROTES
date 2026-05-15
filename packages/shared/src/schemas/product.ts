import { z } from 'zod';
import { BASE_UNITS } from '../enums';

export const upsertProductSchema = z.object({
  id: z.string().uuid().optional(),
  sucursal_id: z.string().uuid(),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  category_id: z.string().uuid().nullable().default(null),
  brand_id: z.string().uuid().nullable().default(null),
  base_unit: z.enum(BASE_UNITS).default('pieza'),
  is_weighed: z.boolean().default(false),
  age_restricted: z.boolean().default(false),
  tax_rate: z.number().min(0).max(1).default(0.16),
  sat_code: z.string().max(20).nullable().default(null),
  sat_unit: z.string().max(10).nullable().default(null),
  default_supplier_id: z.string().uuid().nullable().default(null),
  track_lots: z.boolean().default(false),
  track_expiry: z.boolean().default(false),
  min_stock: z.number().nonnegative().default(0),
  max_stock: z.number().positive().nullable().default(null),
  active: z.boolean().default(true),
});

export const upsertBarcodeSchema = z.object({
  product_id: z.string().uuid(),
  barcode: z.string().min(1).max(64),
  pack_qty: z.number().positive().default(1),
  unit_label: z.string().max(32).default('pieza'),
});

export const upsertCategorySchema = z.object({
  id: z.string().uuid().optional(),
  sucursal_id: z.string().uuid().nullable().default(null),
  parent_id: z.string().uuid().nullable().default(null),
  name: z.string().min(1).max(120),
  sort: z.number().int().default(0),
});

export type UpsertProductInput = z.infer<typeof upsertProductSchema>;
export type UpsertBarcodeInput = z.infer<typeof upsertBarcodeSchema>;
export type UpsertCategoryInput = z.infer<typeof upsertCategorySchema>;
