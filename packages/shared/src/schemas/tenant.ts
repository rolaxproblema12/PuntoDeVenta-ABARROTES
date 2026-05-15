import { z } from 'zod';
import { PLAN_CODES } from '../enums';

/** Alta de un nuevo cliente (tenant) desde la página de registro. */
export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  business_name: z.string().min(2).max(120),
  owner_name: z.string().min(2).max(120),
  plan_code: z.enum(PLAN_CODES).default('basico'),
});

/** Inicia un Stripe Checkout para la suscripción del tenant. */
export const checkoutSchema = z.object({
  plan_code: z.enum(PLAN_CODES),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
