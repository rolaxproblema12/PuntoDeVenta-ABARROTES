import { z } from 'zod';
// (sin imports de enums; este módulo solo usa primitivas zod)

export const upsertSupplierSchema = z.object({
  id: z.string().uuid().optional(),
  sucursal_id: z.string().uuid(),
  name: z.string().min(1).max(160),
  rfc: z.string().max(20).nullable().default(null),
  contact: z.string().max(160).nullable().default(null),
  terms_days: z.number().int().nonnegative().default(0),
  frequent: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const createPurchaseOrderSchema = z.object({
  sucursal_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  expected_at: z.string().datetime().nullable().default(null),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        qty_ordered: z.number().positive(),
        unit_cost: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export const receiveGoodsSchema = z.object({
  po_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        qty_received: z.number().positive(),
        unit_cost: z.number().int().nonnegative(),
        lot_code: z.string().max(64).nullable().default(null),
        expiry_date: z.string().date().nullable().default(null),
      }),
    )
    .min(1),
});

export type UpsertSupplierInput = z.infer<typeof upsertSupplierSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type ReceiveGoodsInput = z.infer<typeof receiveGoodsSchema>;
