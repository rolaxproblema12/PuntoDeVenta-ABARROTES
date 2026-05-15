import { z } from 'zod';
import { CREDIT_MOVEMENT_KINDS } from '../enums.js';

export const upsertCustomerSchema = z.object({
  id: z.string().uuid().optional(),
  sucursal_id: z.string().uuid(),
  name: z.string().min(1).max(160),
  phone: z.string().max(32).nullable().default(null),
  email: z.string().email().nullable().default(null),
  rfc: z.string().max(20).nullable().default(null),
  credit_limit: z.number().int().nonnegative().default(0),
  frequent: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const creditMovementSchema = z.object({
  customer_id: z.string().uuid(),
  kind: z.enum(CREDIT_MOVEMENT_KINDS),
  amount: z.number().int().positive(),
  sale_id: z.string().uuid().nullable().default(null),
  note: z.string().max(280).optional(),
});

export type UpsertCustomerInput = z.infer<typeof upsertCustomerSchema>;
export type CreditMovementInput = z.infer<typeof creditMovementSchema>;
