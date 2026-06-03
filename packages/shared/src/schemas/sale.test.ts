import { describe, expect, it } from 'vitest';
import { createSaleSchema } from './sale';

const UUID = '11111111-1111-1111-1111-111111111111';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    client_op_id: UUID,
    sucursal_id: UUID,
    register_id: UUID,
    cash_session_id: UUID,
    items: [
      {
        product_id: UUID,
        description: 'Producto',
        quantity: 2,
        unit: 'pieza',
        unit_price: 1000,
      },
    ],
    payments: [{ method: 'efectivo', amount: 2000 }],
    ...overrides,
  };
}

describe('createSaleSchema — cobertura de pagos', () => {
  it('acepta pago exacto', () => {
    expect(createSaleSchema.safeParse(payload()).success).toBe(true);
  });

  it('acepta sobrepago (devuelve cambio)', () => {
    const r = createSaleSchema.safeParse(
      payload({ payments: [{ method: 'efectivo', amount: 2500 }] }),
    );
    expect(r.success).toBe(true);
  });

  it('rechaza pago insuficiente', () => {
    const r = createSaleSchema.safeParse(
      payload({ payments: [{ method: 'efectivo', amount: 1500 }] }),
    );
    expect(r.success).toBe(false);
  });

  it('precio IVA-incluido: tax_rate no infla el pago requerido', () => {
    // 1×1000 con tax_rate 0.16 → se cobra 1000 (IVA incluido), no 1160.
    const conIva = (amount: number) =>
      payload({
        items: [
          {
            product_id: UUID,
            description: 'Con IVA',
            quantity: 1,
            unit: 'pieza',
            unit_price: 1000,
            tax_rate: 0.16,
          },
        ],
        payments: [{ method: 'efectivo', amount }],
      });
    expect(createSaleSchema.safeParse(conIva(1000)).success).toBe(true);
    expect(createSaleSchema.safeParse(conIva(900)).success).toBe(false);
  });

  it('una venta a crédito cubre el total con el método credito', () => {
    const r = createSaleSchema.safeParse(
      payload({ payments: [{ method: 'credito', amount: 2000 }] }),
    );
    expect(r.success).toBe(true);
  });

  it("rechaza 'mixto' como método de línea de pago", () => {
    const r = createSaleSchema.safeParse(
      payload({ payments: [{ method: 'mixto', amount: 2000 }] }),
    );
    expect(r.success).toBe(false);
  });

  it('rechaza descuento mayor al precio unitario', () => {
    const r = createSaleSchema.safeParse(
      payload({
        items: [
          {
            product_id: UUID,
            description: 'Sobre-descuento',
            quantity: 1,
            unit: 'pieza',
            unit_price: 1000,
            discount: 1500,
          },
        ],
        payments: [{ method: 'efectivo', amount: 0 }],
      }),
    );
    expect(r.success).toBe(false);
  });

  it('rechaza total de venta en 0', () => {
    const r = createSaleSchema.safeParse(
      payload({
        items: [
          {
            product_id: UUID,
            description: 'Gratis',
            quantity: 1,
            unit: 'pieza',
            unit_price: 1000,
            discount: 1000,
          },
        ],
        payments: [{ method: 'efectivo', amount: 0 }],
      }),
    );
    expect(r.success).toBe(false);
  });
});
