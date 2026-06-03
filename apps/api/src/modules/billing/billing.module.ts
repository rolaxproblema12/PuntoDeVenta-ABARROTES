import {
  BadRequestException,
  Body,
  Controller,
  Injectable,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type Stripe from 'stripe';
import { checkoutSchema, type CheckoutInput } from '@abarrotes/shared';
import { Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { StripeService } from '../../common/stripe/stripe.service';
import { ENV } from '../../config/env';

@Injectable()
class BillingService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly stripeSvc: StripeService,
  ) {}

  /** Crea (o reutiliza) el customer de Stripe del tenant. */
  private async ensureCustomer(tenantId: string): Promise<string> {
    const admin = this.supabase.admin();
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (sub?.stripe_customer_id) return sub.stripe_customer_id;

    const { data: tenant } = await admin
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single();

    const customer = await this.stripeSvc.stripe().customers.create({
      name: tenant?.name ?? 'Tenant',
      metadata: { tenant_id: tenantId },
    });
    await admin
      .from('subscriptions')
      .update({ stripe_customer_id: customer.id })
      .eq('tenant_id', tenantId);
    return customer.id;
  }

  async checkout(tenantId: string, input: CheckoutInput): Promise<{ url: string }> {
    const customer = await this.ensureCustomer(tenantId);
    const session = await this.stripeSvc.stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: this.stripeSvc.priceFor(input.plan_code), quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { tenant_id: tenantId, plan_code: input.plan_code },
      },
      success_url: `${ENV.appPublicUrl}/pos?checkout=ok`,
      cancel_url: `${ENV.appPublicUrl}/billing?checkout=cancel`,
    });
    return { url: session.url! };
  }

  async portal(tenantId: string): Promise<{ url: string }> {
    const customer = await this.ensureCustomer(tenantId);
    const session = await this.stripeSvc.stripe().billingPortal.sessions.create({
      customer,
      return_url: `${ENV.appPublicUrl}/billing`,
    });
    return { url: session.url };
  }

  /** Verifica firma, normaliza el evento y lo aplica idempotentemente. */
  async handleWebhook(rawBody: Buffer, signature: string) {
    const stripe = this.stripeSvc.stripe();
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      ENV.stripeWebhookSecret,
    );

    const obj = event.data.object as Record<string, any>;
    const sub: Stripe.Subscription | null =
      event.type.startsWith('customer.subscription') ? (obj as any) : null;

    const tenantId =
      obj?.metadata?.tenant_id ??
      sub?.metadata?.tenant_id ??
      (await this.tenantByCustomer(obj?.customer));

    const normalized = {
      stripe_event_id: event.id,
      type: event.type,
      tenant_id: tenantId ?? null,
      stripe_customer_id: obj?.customer ?? null,
      stripe_subscription_id: sub?.id ?? obj?.subscription ?? null,
      plan_code: sub?.metadata?.plan_code ?? null,
      sub_status: sub?.status ?? null,
      current_period_end: sub?.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      trial_ends_at: sub?.trial_end
        ? new Date(sub.trial_end * 1000).toISOString()
        : null,
    };

    const { data, error } = await this.supabase
      .admin()
      .rpc('apply_subscription_event', { p: normalized });
    if (error) throw new Error(error.message);
    return data;
  }

  private async tenantByCustomer(
    customerId: string | undefined,
  ): Promise<string | null> {
    if (!customerId) return null;
    const { data } = await this.supabase
      .admin()
      .from('subscriptions')
      .select('tenant_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    return data?.tenant_id ?? null;
  }
}

@ApiTags('billing')
@Controller('billing')
class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Post('checkout')
  checkout(
    @Req() req: any,
    @Body(new ZodValidationPipe(checkoutSchema)) body: CheckoutInput,
  ) {
    if (!req.user?.tenantId) throw new BadRequestException('Sin tenant');
    return this.svc.checkout(req.user.tenantId, body);
  }

  @Post('portal')
  portal(@Req() req: any) {
    if (!req.user?.tenantId) throw new BadRequestException('Sin tenant');
    return this.svc.portal(req.user.tenantId);
  }

  @Public()
  @Post('webhook')
  webhook(@Req() req: any) {
    const sig = req.headers['stripe-signature'];
    if (!sig) throw new BadRequestException('Firma Stripe ausente');
    return this.svc.handleWebhook(req.rawBody, sig);
  }
}

@Module({
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
