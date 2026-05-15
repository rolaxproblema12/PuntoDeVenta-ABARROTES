import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { ENV } from '../../config/env';

/**
 * Cliente Stripe perezoso: la app arranca aunque no haya claves configuradas
 * (tests/build/dev sin Stripe). Lanza solo cuando se usa sin configurar.
 */
@Injectable()
export class StripeService {
  private client: Stripe | null = null;

  get enabled(): boolean {
    return !!ENV.stripeSecretKey;
  }

  stripe(): Stripe {
    if (!this.client) {
      if (!ENV.stripeSecretKey) {
        throw new Error('STRIPE_SECRET_KEY ausente: configura .env.local');
      }
      this.client = new Stripe(ENV.stripeSecretKey, {
        apiVersion: '2025-02-24.acacia',
      });
    }
    return this.client;
  }

  priceFor(planCode: string): string {
    const price = ENV.stripePrices[planCode];
    if (!price) throw new Error(`Sin STRIPE_PRICE para plan ${planCode}`);
    return price;
  }
}
