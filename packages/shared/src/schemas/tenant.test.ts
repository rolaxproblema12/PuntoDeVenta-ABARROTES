import { describe, expect, it } from 'vitest';
import { TENANT_ACTIVE_STATUSES, TENANT_STATUSES } from '../enums';
import { checkoutSchema, signupSchema } from './tenant';

describe('signupSchema', () => {
  it('rechaza contraseña corta y email inválido', () => {
    expect(
      signupSchema.safeParse({
        email: 'no-es-email',
        password: '123',
        business_name: 'X',
        owner_name: 'Y',
      }).success,
    ).toBe(false);
  });

  it('acepta un alta válida con plan por defecto', () => {
    const r = signupSchema.safeParse({
      email: 'dueno@negocio.com',
      password: 'segura123',
      business_name: 'Abarrotes La Esquina',
      owner_name: 'Rolando',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.plan_code).toBe('basico');
  });
});

describe('estados de tenant', () => {
  it('checkout solo acepta planes válidos', () => {
    expect(checkoutSchema.safeParse({ plan_code: 'pro' }).success).toBe(true);
    expect(checkoutSchema.safeParse({ plan_code: 'gratis' }).success).toBe(
      false,
    );
  });

  it('los estados operativos son subconjunto de los estados de tenant', () => {
    for (const s of TENANT_ACTIVE_STATUSES) {
      expect(TENANT_STATUSES).toContain(s);
    }
    expect(TENANT_ACTIVE_STATUSES).not.toContain('suspended');
  });
});
