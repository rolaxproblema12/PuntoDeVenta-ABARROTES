import { describe, expect, it } from 'vitest';
import { fromCents, lineTotalCents, pctOf, sumCents, toCents } from './money.js';

describe('money', () => {
  it('toCents/fromCents round-trips without float drift', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(fromCents(1999)).toBe(19.99);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it('sumCents adds integer cents', () => {
    expect(sumCents([1999, 100, 1])).toBe(2100);
  });

  it('pctOf rounds to the nearest cent', () => {
    expect(pctOf(1000, 16)).toBe(160);
    expect(pctOf(333, 16)).toBe(53);
  });

  it('lineTotalCents applies discount before quantity', () => {
    expect(lineTotalCents(1000, 3, 100)).toBe(2700);
  });
});
