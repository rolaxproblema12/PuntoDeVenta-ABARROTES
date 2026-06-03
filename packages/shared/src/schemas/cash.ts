import { z } from 'zod';

export const openCashSessionSchema = z.object({
  sucursal_id: z.string().uuid(),
  register_id: z.string().uuid(),
  opening_amount: z.number().int().nonnegative(),
});

/**
 * Conteo de denominaciones al cierre: mapa de valor-en-centavos → cantidad de
 * piezas. p.ej. { "20000": 3, "10000": 5 } = 3 billetes de $200 + 5 de $100.
 */
export const denominationsSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);

export const closeCashSessionSchema = z.object({
  counted_cash: z.number().int().nonnegative(),
  closing_notes: z.string().max(280).optional(),
  denominations: denominationsSchema.optional(),
});

/**
 * Ingreso/retiro de efectivo durante una sesión de caja abierta. La sesión va
 * en la ruta (`/cash/sessions/:id/movements`), por eso no está en el cuerpo.
 */
export const cashMovementSchema = z.object({
  kind: z.enum(['ingreso', 'retiro']),
  amount: z.number().int().positive(),
  reason: z.string().min(1).max(200),
});

export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
export type Denominations = z.infer<typeof denominationsSchema>;

/** Denominaciones MXN (centavos) para el contador del corte, de mayor a menor. */
export const MXN_DENOMINATIONS = [
  { cents: 100000, label: '$1000' },
  { cents: 50000, label: '$500' },
  { cents: 20000, label: '$200' },
  { cents: 10000, label: '$100' },
  { cents: 5000, label: '$50' },
  { cents: 2000, label: '$20' },
  { cents: 1000, label: '$10' },
  { cents: 500, label: '$5' },
  { cents: 200, label: '$2' },
  { cents: 100, label: '$1' },
  { cents: 50, label: '$0.50' },
] as const;

/** Resumen de corte (X = lectura, Z = cierre) que devuelven las RPC de caja. */
export interface CashSessionSummary {
  session_id: string;
  status: 'open' | 'closed';
  /** Centavos. */
  opening_amount: number;
  by_method: {
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    credito: number;
  };
  cash_in: number;
  cash_out: number;
  cash_refunds: number;
  ticket_count: number;
  sales_total: number;
  expected_cash: number;
  /** Presentes solo en el corte Z (cierre). */
  counted_cash?: number;
  difference?: number;
  denominations?: Denominations | null;
}
