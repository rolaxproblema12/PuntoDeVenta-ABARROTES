import { z } from 'zod';

/**
 * Movimientos de inventario manuales (entrada/salida/ajuste/merma).
 * Fuente de verdad para el formulario web y el DTO de la API. La escritura
 * real ocurre en la RPC atómica `record_stock_movement`.
 *
 *  - entrada       → quantity (>0); unit_cost/lot_code/expiry_date opcionales
 *                    (crea lote para que FIFO se reabastezca).
 *  - salida/merma  → quantity (>0); merma exige motivo.
 *  - ajuste        → target_qty (conteo físico, >=0); el delta con signo lo
 *                    calcula el servidor. Exige motivo.
 */
export const STOCK_MOVEMENT_KINDS = [
  'entrada',
  'salida',
  'ajuste',
  'merma',
] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

export const stockMovementSchema = z
  .object({
    sucursal_id: z.string().uuid(),
    product_id: z.string().uuid(),
    kind: z.enum(STOCK_MOVEMENT_KINDS),
    /** Para entrada/salida/merma: cantidad positiva en unidad base. */
    quantity: z.number().positive().optional(),
    /** Para ajuste: stock físico contado (objetivo). */
    target_qty: z.number().nonnegative().optional(),
    /** Centavos. Solo entrada; si falta, se usa el costo promedio actual. */
    unit_cost: z.number().int().nonnegative().optional(),
    lot_code: z.string().max(64).nullable().optional(),
    expiry_date: z.string().date().nullable().optional(),
    reason: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'ajuste') {
      if (v.target_qty === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['target_qty'],
          message: 'El ajuste requiere el stock contado (target_qty).',
        });
      }
      if (!v.reason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reason'],
          message: 'El ajuste requiere un motivo.',
        });
      }
    } else {
      if (v.quantity === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['quantity'],
          message: `${v.kind} requiere una cantidad mayor a 0.`,
        });
      }
      if (v.kind === 'merma' && !v.reason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reason'],
          message: 'La merma requiere un motivo.',
        });
      }
    }
  });

export type StockMovementInput = z.infer<typeof stockMovementSchema>;

/** Resultado que devuelve `record_stock_movement`. */
export interface StockMovementResult {
  product_id: string;
  kind: StockMovementKind;
  /** Cantidad efectiva con signo (negativa = salió). */
  applied_qty: number;
  new_stock: number;
  /** Centavos. */
  avg_cost: number;
  lot_id: string | null;
  noop?: boolean;
}
