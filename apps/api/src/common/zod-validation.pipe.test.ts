import { BadRequestException } from '@nestjs/common';
import { createSaleSchema } from '@abarrotes/shared';
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(createSaleSchema);

  it('rejects an invalid sale payload', () => {
    expect(() => pipe.transform({ items: [] })).toThrow(BadRequestException);
  });

  it('accepts a minimal valid sale payload', () => {
    const uuid = '00000000-0000-0000-0000-000000000001';
    const out = pipe.transform({
      client_op_id: uuid,
      sucursal_id: uuid,
      register_id: uuid,
      cash_session_id: uuid,
      items: [
        {
          product_id: uuid,
          description: 'Coca 600ml',
          quantity: 2,
          unit: 'pieza',
          unit_price: 1800,
        },
      ],
      payments: [{ method: 'efectivo', amount: 4176 }],
    });
    expect(out).toBeTruthy();
  });
});
