import { z } from 'zod';
import { createSaleSchema, cancelSaleSchema, createReturnSchema } from './sale';

/**
 * Cuerpo de POST /sync/replay — reproduce una operación encolada offline.
 * Unión discriminada por `op_type`; la rama `sale.create` reusa
 * `createSaleSchema` (única fuente de verdad, igual que POST /sales).
 *
 * `sale.cancel` necesita el id de la venta + motivo; lo expresamos como
 * `cancelSaleSchema` extendido con `sale_id` para no perder validación del
 * motivo y exigir un uuid de venta válido.
 */
export const replaySyncOpSchema = z.discriminatedUnion('op_type', [
  z.object({
    op_type: z.literal('sale.create'),
    payload: createSaleSchema,
  }),
  z.object({
    op_type: z.literal('sale.cancel'),
    payload: cancelSaleSchema.extend({
      sale_id: z.string().uuid(),
      client_op_id: z.string().uuid().optional(),
    }),
  }),
  z.object({
    op_type: z.literal('return.create'),
    payload: createReturnSchema,
  }),
]);

export type ReplaySyncOpInput = z.infer<typeof replaySyncOpSchema>;
