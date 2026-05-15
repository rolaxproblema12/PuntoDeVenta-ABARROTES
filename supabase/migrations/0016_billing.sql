-- 0016_billing: aplica eventos de Stripe de forma idempotente.
-- La API normaliza el evento y llama esta RPC. Dedupe por stripe_event_id.

create or replace function apply_subscription_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_evt    text := p->>'stripe_event_id';
  v_type   text := p->>'type';
  v_tenant uuid := nullif(p->>'tenant_id','')::uuid;
  v_sub    text := p->>'sub_status';
  v_plan   text := nullif(p->>'plan_code','');
  v_tstat  tenant_status;
begin
  -- Idempotencia: si el evento ya se procesó, no repetir efectos.
  insert into billing_events (tenant_id, stripe_event_id, type, payload)
  values (v_tenant, v_evt, v_type, p)
  on conflict (stripe_event_id) do nothing;
  if not found then
    return jsonb_build_object('status','duplicate');
  end if;

  if v_tenant is null then
    return jsonb_build_object('status','no_tenant');
  end if;

  insert into subscriptions (tenant_id, stripe_customer_id,
    stripe_subscription_id, plan_code, status, current_period_end,
    trial_ends_at, updated_at)
  values (
    v_tenant, nullif(p->>'stripe_customer_id',''),
    nullif(p->>'stripe_subscription_id',''),
    coalesce(v_plan, (select plan_code from tenants where id = v_tenant)),
    coalesce(v_sub,'active'),
    nullif(p->>'current_period_end','')::timestamptz,
    nullif(p->>'trial_ends_at','')::timestamptz, now())
  on conflict (tenant_id) do update set
    stripe_customer_id     = coalesce(excluded.stripe_customer_id,
                                      subscriptions.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id,
                                      subscriptions.stripe_subscription_id),
    plan_code              = coalesce(v_plan, subscriptions.plan_code),
    status                 = coalesce(v_sub, subscriptions.status),
    current_period_end     = coalesce(excluded.current_period_end,
                                      subscriptions.current_period_end),
    trial_ends_at          = coalesce(excluded.trial_ends_at,
                                      subscriptions.trial_ends_at),
    updated_at             = now();

  -- Mapea estado de suscripción Stripe → estado del tenant.
  v_tstat := case coalesce(v_sub,'active')
    when 'trialing'   then 'trial'
    when 'active'     then 'active'
    when 'past_due'   then 'past_due'
    when 'unpaid'     then 'suspended'
    when 'canceled'   then 'canceled'
    when 'incomplete' then 'past_due'
    else 'active' end::tenant_status;

  update tenants
  set status = v_tstat,
      plan_code = coalesce(v_plan, plan_code)
  where id = v_tenant;

  return jsonb_build_object('status','applied','tenant_status', v_tstat);
end $$;
