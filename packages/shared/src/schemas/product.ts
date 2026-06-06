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

/**
 * Payload del alta/edición de producto desde la web hacia la RPC atómica
 * `upsert_product` (products + product_prices + product_barcodes + stock inicial).
 * `price`/`cost` en centavos; `initial_stock` solo aplica en el alta.
 */
export const saveProductSchema = upsertProductSchema.extend({
  price: z.number().int().nonnegative().default(0),
  cost: z.number().int().nonnegative().default(0),
  barcode: z.string().trim().max(64).nullable().default(null),
  initial_stock: z.number().nonnegative().default(0),
});

/**
 * Payload de actualización NO destructiva (RPC `patch_product`, migración 0029).
 * A diferencia de `saveProductSchema`, TODOS los campos son opcionales y SIN
 * `.default(...)`: lo que se omite no se toca (merge por COALESCE en la RPC), de
 * modo que actualizar un duplicado al importar no borra categoría/IVA/proveedor
 * ni los códigos secundarios. `price`/`cost`/`mayoreo` en centavos.
 */
export const patchProductSchema = z.object({
  id: z.string().uuid(),
  sucursal_id: z.string().uuid(),
  sku: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(160).optional(),
  category_id: z.string().uuid().nullable().optional(),
  brand_id: z.string().uuid().nullable().optional(),
  base_unit: z.enum(BASE_UNITS).optional(),
  is_weighed: z.boolean().optional(),
  age_restricted: z.boolean().optional(),
  tax_rate: z.number().min(0).max(1).optional(),
  default_supplier_id: z.string().uuid().nullable().optional(),
  track_lots: z.boolean().optional(),
  track_expiry: z.boolean().optional(),
  min_stock: z.number().nonnegative().optional(),
  max_stock: z.number().positive().nullable().optional(),
  sat_code: z.string().max(20).nullable().optional(),
  sat_unit: z.string().max(10).nullable().optional(),
  active: z.boolean().optional(),
  price: z.number().int().nonnegative().optional(),
  cost: z.number().int().nonnegative().optional(),
  mayoreo: z.number().int().nonnegative().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
});

/**
 * Ajuste de existencias en lote (RPC `set_stock_levels`, 0029). Cada item fija el
 * stock ABSOLUTO del producto (idempotente: re-importar no duplica). `reason`
 * obligatorio para la auditoría del movimiento de inventario.
 */
export const setStockSchema = z.object({
  sucursal_id: z.string().uuid(),
  reason: z.string().min(1).max(160),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        target_qty: z.number().nonnegative(),
        /** Costo unitario en centavos: fija el costo promedio al subir stock. */
        unit_cost: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
});

export type UpsertProductInput = z.infer<typeof upsertProductSchema>;
export type UpsertBarcodeInput = z.infer<typeof upsertBarcodeSchema>;
export type UpsertCategoryInput = z.infer<typeof upsertCategorySchema>;
export type SaveProductInput = z.infer<typeof saveProductSchema>;
export type PatchProductInput = z.infer<typeof patchProductSchema>;
export type SetStockInput = z.infer<typeof setStockSchema>;
