-- 0020_cash_movements: ingresos/retiros de efectivo en la sesión, corte X
-- (lectura) y corte Z (cierre) con efectivo esperado CORRECTO por método de
-- pago (efectivo + ingresos − retiros − devoluciones en efectivo) + conteo de
-- denominaciones. Toda escritura del cierre ocurre en UNA función. Idempotente.

create table if not exists cash_movements (
  id              uuid primary key default gen_random_uuid(),
  sucursal_id     uuid not null references sucursales(id) on delete cascade,
  cash_session_id uuid not null references cash_sessions(id) on delete cascade,
  kind            text not null check (kind in ('ingreso', 'retiro')),
  amount          bigint not null check (amount > 0),     -- centavos
  reason          text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references profiles(id)
);
call apply_sucursal_rls('cash_movements');
create index if not exists idx_cash_mov_session
  on cash_movements (cash_session_id, created_at);

-- Columnas extra del cierre (idempotentes).
alter table cash_sessions add column if not exists denominations jsonb;
alter table cash_sessions add column if not exists cash_in   bigint;
alter table cash_sessions add column if not exists cash_out  bigint;
alter table cash_sessions add column if not exists closed_at timestamptz;
alter table cash_sessions add column if not exists closed_by uuid references profiles(id);

-- ── cash_session_summary: cálculo del corte (compartido por X y Z) ───────────
create or replace function cash_session_summary(p_session uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_suc uuid; v_open bigint; v_status text;
  v_efe bigint; v_tar bigint; v_tra bigint; v_cre bigint;
  v_in bigint; v_out bigint; v_ref bigint; v_tickets int; v_total bigint;
  v_expected bigint;
begin
  select sucursal_id, opening_amount, status
    into v_suc, v_open, v_status
  from cash_sessions where id = p_session;
  if v_suc is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;

  -- Ventas por método de pago real (no por sales.total, que mezcla métodos).
  select
    coalesce(sum(sp.amount) filter (where sp.method = 'efectivo'), 0),
    coalesce(sum(sp.amount) filter (where sp.method = 'tarjeta'), 0),
    coalesce(sum(sp.amount) filter (where sp.method = 'transferencia'), 0),
    coalesce(sum(sp.amount) filter (where sp.method = 'credito'), 0)
  into v_efe, v_tar, v_tra, v_cre
  from sale_payments sp
  join sales s on s.id = sp.sale_id
  where s.cash_session_id = p_session and s.status = 'completada';

  select coalesce(count(*), 0), coalesce(sum(total), 0)
  into v_tickets, v_total
  from sales where cash_session_id = p_session and status = 'completada';

  select coalesce(sum(amount) filter (where kind = 'ingreso'), 0),
         coalesce(sum(amount) filter (where kind = 'retiro'), 0)
  into v_in, v_out
  from cash_movements where cash_session_id = p_session;

  -- Solo devoluciones en efectivo ocurridas hasta el cierre (o hasta ahora si
  -- la sesión sigue abierta): una devolución posterior al corte no debe alterar
  -- retroactivamente el efectivo esperado de esa sesión.
  select coalesce(sum(r.total), 0) into v_ref
  from returns r
  join sales s on s.id = r.sale_id
  where s.cash_session_id = p_session and r.refund_method = 'efectivo'
    and r.created_at <= coalesce(
      (select closed_at from cash_sessions where id = p_session), now());

  v_expected := v_open + v_efe + v_in - v_out - v_ref;

  return jsonb_build_object(
    'session_id', p_session, 'status', v_status,
    'opening_amount', v_open,
    'by_method', jsonb_build_object(
      'efectivo', v_efe, 'tarjeta', v_tar,
      'transferencia', v_tra, 'credito', v_cre),
    'cash_in', v_in, 'cash_out', v_out, 'cash_refunds', v_ref,
    'ticket_count', v_tickets, 'sales_total', v_total,
    'expected_cash', v_expected);
end $$;

-- ── register_cash_movement: ingreso/retiro de efectivo (sesión abierta) ──────
create or replace function register_cash_movement(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sess   uuid   := (p_payload->>'cash_session_id')::uuid;
  v_kind   text   := p_payload->>'kind';
  v_amt    bigint := nullif(p_payload->>'amount', '')::bigint;
  v_reason text   := nullif(trim(p_payload->>'reason'), '');
  v_suc    uuid;
begin
  select sucursal_id into v_suc
  from cash_sessions where id = v_sess and status = 'open';
  if v_suc is null then
    raise exception 'CASH_SESSION_CLOSED' using errcode = 'check_violation';
  end if;
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;
  if v_kind not in ('ingreso', 'retiro') then
    raise exception 'BAD_KIND' using errcode = 'check_violation';
  end if;
  if v_amt is null or v_amt <= 0 then
    raise exception 'BAD_AMOUNT' using errcode = 'check_violation';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'check_violation';
  end if;

  insert into cash_movements (sucursal_id, cash_session_id, kind, amount,
                              reason, created_by)
  values (v_suc, v_sess, v_kind, v_amt, v_reason, auth.uid());

  return cash_session_summary(v_sess);
end $$;

-- ── close_cash_session: corte Z atómico con efectivo esperado correcto ───────
create or replace function close_cash_session(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sess    uuid   := (p_payload->>'session_id')::uuid;
  v_counted bigint := coalesce(nullif(p_payload->>'counted_cash', '')::bigint, 0);
  v_notes   text   := nullif(p_payload->>'closing_notes', '');
  v_denoms  jsonb  := p_payload->'denominations';
  v_suc uuid; v_status text;
  v_counted_prev bigint; v_diff_prev bigint; v_denoms_prev jsonb;
  v_summary jsonb; v_expected bigint; v_diff bigint;
begin
  select sucursal_id, status, counted_cash, difference, denominations
    into v_suc, v_status, v_counted_prev, v_diff_prev, v_denoms_prev
  from cash_sessions where id = v_sess;
  if v_suc is null then
    raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'no_data_found';
  end if;
  if not is_active_user_in_sucursal(v_suc) then
    raise exception 'FORBIDDEN_SUCURSAL' using errcode = 'insufficient_privilege';
  end if;

  -- Idempotente: un reintento (timeout/doble-clic) sobre una sesión ya cerrada
  -- devuelve el corte tal como quedó, sin error ni re-escritura.
  if v_status = 'closed' then
    return cash_session_summary(v_sess) || jsonb_build_object(
      'status', 'closed', 'counted_cash', coalesce(v_counted_prev, 0),
      'difference', coalesce(v_diff_prev, 0), 'denominations', v_denoms_prev,
      'already_closed', true);
  end if;

  v_summary  := cash_session_summary(v_sess);
  v_expected := (v_summary->>'expected_cash')::bigint;
  v_diff     := v_counted - v_expected;

  update cash_sessions set
    status        = 'closed',
    expected_cash = v_expected,
    counted_cash  = v_counted,
    difference    = v_diff,
    cash_in       = (v_summary->>'cash_in')::bigint,
    cash_out      = (v_summary->>'cash_out')::bigint,
    denominations = v_denoms,
    closing_notes = v_notes,
    closed_at     = now(),
    closed_by     = auth.uid(),
    updated_at    = now()
  where id = v_sess and status = 'open';   -- atómico: evita doble cierre en carrera

  return v_summary || jsonb_build_object(
    'status', 'closed', 'counted_cash', v_counted,
    'difference', v_diff, 'denominations', v_denoms);
end $$;
