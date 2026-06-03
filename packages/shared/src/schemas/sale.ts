import { z } from 'zod';
import { BASE_UNITS, PAYMENT_LINE_METHODS, SALE_ITEM_KINDS } from '../enums';
import { lineTotalCents } from '../money';

/** Línea de venta enviada a la API (montos en centavos enteros). */
export const saleItemInputSchema = z
  .object({
    kind: z.enum(SALE_ITEM_KINDS).default('producto'),
    product_id: z.string().uuid().nullable(),
    variant_id: z.string().uuid().nullable().default(null),
    description: z.string().min(1).max(200),
    quantity: z.number().positive(),
    unit: z.enum(BASE_UNITS),
    unit_price: z.number().int().nonnegative(),
    unit_cost: z.number().int().nonnegative().default(0),
    tax_rate: z.number().min(0).max(1).default(0),
    discount: z.number().int().nonnegative().default(0),
  })
  // El descuento por unidad nunca puede exceder el precio (línea/total negativos).
  .refine((it) => it.discount <= it.unit_price, {
    message: 'El descuento no puede exceder el precio unitario',
    path: ['discount'],
  });

export const salePaymentInputSchema = z.object({
  // 'mixto' no es método de línea (ver PAYMENT_LINE_METHODS).
  method: z.enum(PAYMENT_LINE_METHODS),
  amount: z.number().int().nonnegative(),
  reference: z.string().max(120).nullable().default(null),
});

/** Payload de creación de venta (también es el cuerpo del POST /sales). */
export const createSaleSchema = z
  .object({
    /** Clave de idempotencia generada en el cliente (uuid v7). */
    client_op_id: z.string().uuid(),
    sucursal_id: z.string().uuid(),
    register_id: z.string().uuid(),
    cash_session_id: z.string().uuid(),
    customer_id: z.string().uuid().nullable().default(null),
    items: z.array(saleItemInputSchema).min(1),
    payments: z.array(salePaymentInputSchema).min(1),
    tip: z.number().int().nonnegative().default(0),
    note: z.string().max(280).optional(),
  })
  .refine(
    (s) => {
      // El total a cobrar es la suma de líneas (precio − descuento) × cantidad
      // + propina, igual que `cart.totalCents()` en el POS. Los precios son
      // IVA-incluido, por eso NO se suma impuesto aquí (hacerlo rechazaría toda
      // venta con tax_rate). Los pagos deben cubrir ese total — el monto del
      // método 'credito' también viaja dentro de payments.
      const total =
        s.items.reduce(
          (acc, it) =>
            acc + lineTotalCents(it.unit_price, it.quantity, it.discount ?? 0),
          0,
        ) + (s.tip ?? 0);
      const paid = s.payments.reduce((a, p) => a + p.amount, 0);
      return paid >= total;
    },
    'Los pagos no cubren el total de la venta',
  )
  .refine(
    (s) => {
      // Una venta debe tener un total mayor a 0 (evita tickets en 0 o negativos).
      const total =
        s.items.reduce(
          (acc, it) =>
            acc + lineTotalCents(it.unit_price, it.quantity, it.discount ?? 0),
          0,
        ) + (s.tip ?? 0);
      return total > 0;
    },
    'El total de la venta debe ser mayor a 0',
  );

export const cancelSaleSchema = z.object({
  reason: z.string().min(3).max(280),
});

export const createReturnSchema = z.object({
  client_op_id: z.string().uuid(),
  sale_id: z.string().uuid(),
  reason: z.string().min(3).max(280),
  refund_method: z.enum(PAYMENT_LINE_METHODS),
  items: z
    .array(
      z.object({
        sale_item_id: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
});

export type SaleItemInput = z.infer<typeof saleItemInputSchema>;
export type SalePaymentInput = z.infer<typeof salePaymentInputSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type CancelSaleInput = z.infer<typeof cancelSaleSchema>;
export type CreateReturnInput = z.infer<typeof createReturnSchema>;
