import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ENV } from './config/env';
import { SupabaseModule } from './common/supabase/supabase.module';
import { StripeModule } from './common/stripe/stripe.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { BillingModule } from './modules/billing/billing.module';
import { PlatformModule } from './modules/platform/platform.module';
import { SupabaseJwtGuard } from './common/guards/supabase-jwt.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PinGuard } from './common/guards/pin.guard';
import { TenantActiveGuard } from './common/guards/tenant-active.guard';
import { PlatformAdminGuard } from './common/guards/platform-admin.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { createSkeletonModule } from './common/skeleton.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { SalesModule } from './modules/sales/sales.module';
import { CashModule } from './modules/cash/cash.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { SyncModule } from './modules/sync/sync.module';

/** Módulos esqueleto (Fase 0): funcionales por fase posterior. */
const skeletons = [
  createSkeletonModule('pricing', 'price_lists'),
  createSkeletonModule('transfers', 'transfers'),
  createSkeletonModule('customers', 'customers'),
  createSkeletonModule('credit', 'customer_credit_movements'),
  createSkeletonModule('purchasing', 'purchase_orders'),
  createSkeletonModule('reports', null),
  createSkeletonModule('settings', 'settings'),
  createSkeletonModule('smart', 'ai_signals'),
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    ThrottlerModule.forRoot([
      { ttl: ENV.throttleTtlMs, limit: ENV.throttleLimit },
    ]),
    SupabaseModule,
    StripeModule,
    HealthModule,
    AuthModule,
    OnboardingModule,
    BillingModule,
    PlatformModule,
    SalesModule,
    CashModule,
    InventoryModule,
    CatalogModule,
    SyncModule,
    ...skeletons,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseJwtGuard },
    { provide: APP_GUARD, useClass: PlatformAdminGuard },
    { provide: APP_GUARD, useClass: TenantActiveGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PinGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
