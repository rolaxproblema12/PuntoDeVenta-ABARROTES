import { z } from 'zod';

export const openCashSessionSchema = z.object({
  sucursal_id: z.string().uuid(),
  register_id: z.string().uuid(),
  opening_amount: z.number().int().nonnegative(),
});

export const closeCashSessionSchema = z.object({
  counted_cash: z.number().int().nonnegative(),
  closing_notes: z.string().max(280).optional(),
});

export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;
