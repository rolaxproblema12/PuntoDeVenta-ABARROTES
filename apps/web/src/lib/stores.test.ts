import { describe, expect, it, beforeEach } from 'vitest';
import type { CartLine } from '@abarrotes/shared';
import { useCart } from './stores';

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: '00000000-0000-0000-0000-000000000001',
  variantId: null,
  description: 'Coca 600ml',
  quantity: 2,
  unit: 'pieza',
  unitPrice: 1800,
  unitCost: 1200,
  taxRate: 0.16,
  discount: 0,
  ...over,
});

describe('cart store', () => {
  beforeEach(() => useCart.getState().clear());

  it('totals lines in cents applying discount', () => {
    useCart.getState().add(line());
    useCart.getState().add(line({ quantity: 1, discount: 100 }));
    // 1800*2 + (1800-100)*1 = 3600 + 1700
    expect(useCart.getState().totalCents()).toBe(5300);
  });

  it('removes a line by index', () => {
    useCart.getState().add(line());
    useCart.getState().add(line({ description: 'Sabritas' }));
    useCart.getState().remove(0);
    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().lines[0]!.description).toBe('Sabritas');
  });
});
