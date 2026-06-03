import { describe, expect, it } from 'vitest';
import { replaySyncOpSchema } from './sync';
import type { CreateSaleInput } from './sale';

const validSale: CreateSaleInput = {
  client_op_id: '11111111-1111-1111-1111-111111111111',
  sucursal_id: '22222222-2222-2222-2222-222222222222',
  register_id: '33333333-3333-3333-3333-333333333333',
  cash_session_id: '44444444-4444-4444-4444-444444444444',
  customer_id: null,
  items: [
    {
      kind: 'producto',
      product_id: '55555555-5555-5555-5555-555555555555',
      variant_id: null,
      description: 'Refresco 600ml',
      quantity: 2,
      unit: 'pieza',
      unit_price: 1800,
      unit_cost: 1200,
      tax_rate: 0,
      discount: 0,
    },
  ],
  payments: [{ method: 'efectivo', amount: 3600, reference: null }],
  tip: 0,
};

describe('replaySyncOpSchema', () => {
  it('acepta una operación sale.create válida', () => {
    expect(
      replaySyncOpSchema.safeParse({
        op_type: 'sale.create',
        payload: validSale,
      }).success,
    ).toBe(true);
  });

  it('rechaza un op_type desconocido', () => {
    expect(
      replaySyncOpSchema.safeParse({
        op_type: 'sale.frobnicate',
        payload: validSale,
      }).success,
    ).toBe(false);
  });

  it('rechaza sale.create con items vacíos', () => {
    expect(
      replaySyncOpSchema.safeParse({
        op_type: 'sale.create',
        payload: { ...validSale, items: [] },
      }).success,
    ).toBe(false);
  });

  it('sale.cancel exige un sale_id uuid válido', () => {
    expect(
      replaySyncOpSchema.safeParse({
        op_type: 'sale.cancel',
        payload: { reason: 'cliente arrepentido' },
      }).success,
    ).toBe(false);

    expect(
      replaySyncOpSchema.safeParse({
        op_type: 'sale.cancel',
        payload: { sale_id: 'no-es-uuid', reason: 'cliente arrepentido' },
      }).success,
    ).toBe(false);

    expect(
      replaySyncOpSchema.safeParse({
        op_type: 'sale.cancel',
        payload: {
          sale_id: '66666666-6666-6666-6666-666666666666',
          reason: 'cliente arrepentido',
        },
      }).success,
    ).toBe(true);
  });
});
