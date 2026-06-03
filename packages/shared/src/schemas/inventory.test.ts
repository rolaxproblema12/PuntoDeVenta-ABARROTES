import { describe, expect, it } from 'vitest';
import { stockMovementSchema } from './inventory';

const SUC = '11111111-1111-1111-1111-111111111111';
const PROD = 'a0000000-0000-0000-0000-000000000001';

describe('stockMovementSchema', () => {
  it('acepta una entrada con costo, lote y caducidad', () => {
    const r = stockMovementSchema.safeParse({
      sucursal_id: SUC,
      product_id: PROD,
      kind: 'entrada',
      quantity: 24,
      unit_cost: 1200,
      lot_code: 'L-042',
      expiry_date: '2026-12-31',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza entrada sin cantidad', () => {
    const r = stockMovementSchema.safeParse({
      sucursal_id: SUC,
      product_id: PROD,
      kind: 'entrada',
    });
    expect(r.success).toBe(false);
  });

  it('exige target_qty y motivo en un ajuste', () => {
    const sinMotivo = stockMovementSchema.safeParse({
      sucursal_id: SUC,
      product_id: PROD,
      kind: 'ajuste',
      target_qty: 10,
    });
    expect(sinMotivo.success).toBe(false);

    const ok = stockMovementSchema.safeParse({
      sucursal_id: SUC,
      product_id: PROD,
      kind: 'ajuste',
      target_qty: 0,
      reason: 'conteo físico mensual',
    });
    expect(ok.success).toBe(true);
  });

  it('exige motivo en una merma', () => {
    const r = stockMovementSchema.safeParse({
      sucursal_id: SUC,
      product_id: PROD,
      kind: 'merma',
      quantity: 3,
    });
    expect(r.success).toBe(false);
  });

  it('permite salida sin motivo', () => {
    const r = stockMovementSchema.safeParse({
      sucursal_id: SUC,
      product_id: PROD,
      kind: 'salida',
      quantity: 2,
    });
    expect(r.success).toBe(true);
  });
});
