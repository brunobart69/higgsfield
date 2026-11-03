-- =====================================================================
-- JB RENT PRO — Migration 0004: reservas, contratos, pagamentos e cauções
-- ---------------------------------------------------------------------
--   * cálculo do contrato NO BANCO (dias, valor base, extras, km excedente,
--     total) — a interface só mostra uma prévia com a mesma fórmula
--   * fluxo de status com regras (entrega exige km/combustível etc.)
--   * status do veículo sincronizado na entrega/devolução
--   * pagamentos (com estorno e anulação, nunca exclusão)
--   * cauções em tabela própria — NUNCA entram como receita
--   * lançamentos financeiros do contrato gerados automaticamente
--     (competência = data de devolução; pago quando o saldo zera)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Novos campos
-- ---------------------------------------------------------------------
alter table public.companies
  add column rental_grace_minutes smallint not null default 0 check (rental_grace_minutes between 0 and 720);

alter table public.rentals
  add column rental_days           integer not null default 1 check (rental_days >= 1),
  add column base_amount           numeric(12,2) not null default 0 check (base_amount >= 0),
  add column extras_amount         numeric(12,2) not null default 0 check (extras_amount >= 0),
  add column allowed_km            integer check (allowed_km >= 0),
  add column excess_km             integer not null default 0 check (excess_km >= 0),
  add column excess_mileage_amount numeric(12,2) not null default 0 check (excess_mileage_amount >= 0),
  add column picked_up_at          timestamptz,
  add column pickup_location       text,
  add column return_location       text,
  add column return_notes          text;

alter table public.financial_transactions
  add column rental_line text check (rental_line in ('rental', 'extras', 'excess_mileage'));
create unique index ft_rental_line_uidx on public.financial_transactions(rental_id, rental_line)
  where rental_line is not null;

-- ---------------------------------------------------------------------
-- Funções de cálculo (imutáveis → testáveis isoladamente)
-- ---------------------------------------------------------------------
-- Dias cobrados: blocos de 24 h a partir da retirada, com tolerância em minutos.
create or replace function app.rental_charge_days(p_pickup timestamptz, p_return timestamptz, p_grace_minutes integer default 0)
returns integer
language sql immutable
as $$
  select greatest(1, ceil(greatest(0, extract(epoch from (p_return - p_pickup)) - coalesce(p_grace_minutes, 0) * 60) / 86400.0)::integer)
$$;

-- Valor base conforme a modalidade: diária × dias; semanal e mensal proporcionais
-- ao dia (semana = 7 dias, mês = 30 dias); personalizado = valor fechado.
create or replace function app.rental_base_amount(p_mode public.rental_pricing_mode, p_unit numeric, p_days integer)
returns numeric
language sql immutable
as $$
  select round(case p_mode
    when 'daily'   then p_unit * p_days
    when 'weekly'  then p_unit * p_days / 7.0
    when 'monthly' then p_unit * p_days / 30.0
    else p_unit
  end, 2)
$$;

-- Quilometragem incluída no contrato (null = ilimitada)
create or replace function app.rental_allowed_km(p_policy public.mileage_policy, p_limit integer, p_days integer)
returns integer
language sql immutable
as $$
  select case p_policy
    when 'unlimited' then null
    when 'daily'   then p_limit * p_days
    when 'weekly'  then p_limit * ceil(p_days / 7.0)::integer
    when 'monthly' then p_limit * ceil(p_days / 30.0)::integer
    else p_limit
  end
$$;

-- ---------------------------------------------------------------------
-- Extras do contrato (catálogo de taxas ou itens livres)
-- ---------------------------------------------------------------------
create table public.rental_extras (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  rental_id    uuid not null references public.rentals(id) on delete cascade,
  fee_id       uuid references public.fee_catalog(id) on delete set null,
  name         text not null check (length(trim(name)) between 1 and 120),
  amount       numeric(10,2) not null check (amount >= 0),
  charge_type  public.fee_charge_type not null default 'per_rental',
  quantity     integer not null default 1 check (quantity between 1 and 99),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null
);
create index rental_extras_rental_idx on public.rental_extras(rental_id);

-- ---------------------------------------------------------------------
-- Cálculo e regras do contrato (BEFORE INSERT/UPDATE)
-- ---------------------------------------------------------------------
create or replace function app.compute_rental()
returns trigger
language plpgsql
as $$
declare
  v_grace integer;
  v_driven integer;
  v_locked boolean;
begin
  -- fluxo de status
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'reservation' and new.status in ('confirmed', 'cancelled', 'in_progress')) or
      (old.status = 'confirmed'   and new.status in ('in_progress', 'cancelled', 'reservation')) or
      (old.status = 'in_progress' and new.status in ('completed', 'late')) or
      (old.status = 'late'        and new.status in ('completed', 'in_progress'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' and new.status not in ('reservation', 'confirmed') then
    raise exception 'INVALID_STATUS_TRANSITION: new contract must start as reservation or confirmed' using errcode = 'P0001';
  end if;

  -- contrato finalizado/cancelado: valores e período congelados
  if tg_op = 'UPDATE' and old.status in ('completed', 'cancelled') then
    v_locked := (new.vehicle_id, new.customer_id, new.pickup_at, new.return_at, new.pricing_mode, new.unit_price,
                 new.discount_amount, new.extra_fees_amount, new.mileage_policy, new.mileage_limit_km,
                 new.excess_km_price, new.start_mileage, new.end_mileage, new.deposit_amount)
                is distinct from
                (old.vehicle_id, old.customer_id, old.pickup_at, old.return_at, old.pricing_mode, old.unit_price,
                 old.discount_amount, old.extra_fees_amount, old.mileage_policy, old.mileage_limit_km,
                 old.excess_km_price, old.start_mileage, old.end_mileage, old.deposit_amount);
    if v_locked then
      raise exception 'RENTAL_LOCKED: completed or cancelled contracts cannot change' using errcode = 'P0001';
    end if;
  end if;
  -- em andamento: veículo, cliente e retirada não mudam
  if tg_op = 'UPDATE' and old.status in ('in_progress', 'late')
     and (new.vehicle_id, new.customer_id, new.pickup_at) is distinct from (old.vehicle_id, old.customer_id, old.pickup_at) then
    raise exception 'RENTAL_LOCKED: vehicle, customer and pickup cannot change after delivery' using errcode = 'P0001';
  end if;

  if new.status in ('in_progress', 'late', 'completed') and (new.start_mileage is null or new.start_fuel_level is null) then
    raise exception 'PICKUP_DATA_REQUIRED' using errcode = 'P0001';
  end if;
  if new.status = 'completed' and (new.end_mileage is null or new.end_fuel_level is null or new.actual_return_at is null) then
    raise exception 'RETURN_DATA_REQUIRED' using errcode = 'P0001';
  end if;
  if new.status = 'cancelled' and coalesce(trim(new.cancelled_reason), '') = '' then
    raise exception 'CANCEL_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if new.status = 'in_progress' and new.picked_up_at is null then
    new.picked_up_at := now();
  end if;

  -- cálculo
  select coalesce(c.rental_grace_minutes, 0) into v_grace from public.companies c where c.id = new.company_id;
  new.rental_days := app.rental_charge_days(new.pickup_at, new.return_at, v_grace);
  new.base_amount := app.rental_base_amount(new.pricing_mode, new.unit_price, new.rental_days);
  new.extras_amount := coalesce((
    select round(sum(e.amount * e.quantity * case when e.charge_type = 'per_day' then new.rental_days else 1 end), 2)
    from public.rental_extras e where e.rental_id = new.id), 0);
  new.allowed_km := app.rental_allowed_km(new.mileage_policy, new.mileage_limit_km, new.rental_days);

  if new.end_mileage is not null and new.start_mileage is not null and new.allowed_km is not null then
    v_driven := new.end_mileage - new.start_mileage;
    new.excess_km := greatest(0, v_driven - new.allowed_km);
  else
    new.excess_km := 0;
  end if;
  new.excess_mileage_amount := round(new.excess_km * coalesce(new.excess_km_price, 0), 2);

  if new.discount_amount > new.base_amount + new.extra_fees_amount then
    raise exception 'DISCOUNT_TOO_HIGH' using errcode = 'P0001';
  end if;
  new.total_amount := new.base_amount + new.extra_fees_amount - new.discount_amount
                      + new.extras_amount + new.excess_mileage_amount;
  return new;
end;
$$;

create trigger rentals_compute before insert or update on public.rentals
  for each row execute function app.compute_rental();

-- Extras alteram o total: força o recálculo do contrato
create or replace function app.touch_rental_from_extra()
returns trigger
language plpgsql
as $$
begin
  update public.rentals set updated_at = now() where id = coalesce(new.rental_id, old.rental_id);
  return null;
end;
$$;

-- Extras de contratos fechados não podem mudar
create or replace function app.guard_rental_extra()
returns trigger
language plpgsql
as $$
declare
  v_status public.rental_status;
begin
  select status into v_status from public.rentals where id = coalesce(new.rental_id, old.rental_id);
  if v_status in ('completed', 'cancelled') then
    raise exception 'RENTAL_LOCKED' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger rental_extras_guard before insert or update or delete on public.rental_extras
  for each row execute function app.guard_rental_extra();
create trigger rental_extras_touch after insert or update or delete on public.rental_extras
  for each row execute function app.touch_rental_from_extra();
create trigger rental_extras_audit before insert or update on public.rental_extras
  for each row execute function app.set_audit_fields();
create trigger rental_extras_log after insert or update or delete on public.rental_extras
  for each row execute function app.log_activity();

-- ---------------------------------------------------------------------
-- Pagamentos do contrato (fluxo de caixa)
-- ---------------------------------------------------------------------
create type public.payment_kind as enum ('payment', 'refund');

create table public.rental_payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  rental_id     uuid not null references public.rentals(id) on delete restrict,
  kind          public.payment_kind not null default 'payment',
  amount        numeric(12,2) not null check (amount > 0),
  paid_at       date not null,
  method        public.payment_method not null,
  reference     text check (reference is null or length(reference) <= 120),
  notes         text,
  voided_at     timestamptz,
  void_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  constraint rental_payments_void_chk check (voided_at is null or coalesce(trim(void_reason), '') <> '')
);
create index rental_payments_rental_idx on public.rental_payments(rental_id) where voided_at is null;
create index rental_payments_paid_idx on public.rental_payments(company_id, paid_at) where voided_at is null;

-- Só a anulação (com motivo) é permitida depois de registrado
create or replace function app.guard_rental_payment()
returns trigger
language plpgsql
as $$
begin
  if (new.rental_id, new.kind, new.amount, new.paid_at, new.method) is distinct from
     (old.rental_id, old.kind, old.amount, old.paid_at, old.method) then
    raise exception 'PAYMENT_IMMUTABLE: void it and register a new one' using errcode = 'P0001';
  end if;
  if old.voided_at is not null and new.voided_at is null then
    raise exception 'PAYMENT_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger rental_payments_guard before update on public.rental_payments
  for each row execute function app.guard_rental_payment();

-- ---------------------------------------------------------------------
-- Cauções (nunca contabilizadas como receita)
-- ---------------------------------------------------------------------
create table public.deposits (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  rental_id        uuid not null unique references public.rentals(id) on delete restrict,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  vehicle_id       uuid not null references public.vehicles(id) on delete restrict,
  amount_received  numeric(12,2) not null default 0 check (amount_received >= 0),
  received_at      date,
  received_method  public.payment_method,
  amount_returned  numeric(12,2) not null default 0 check (amount_returned >= 0),
  returned_at      date,
  returned_method  public.payment_method,
  amount_retained  numeric(12,2) not null default 0 check (amount_retained >= 0),
  retention_reason text,
  notes            text,
  status           text generated always as (
                     case when amount_received = 0 then 'not_received'
                          when amount_returned + amount_retained >= amount_received then 'settled'
                          else 'held' end) stored,
  balance          numeric(12,2) generated always as (amount_received - amount_returned - amount_retained) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  constraint deposits_amounts_chk check (amount_returned + amount_retained <= amount_received),
  constraint deposits_received_chk check (amount_received = 0 or received_at is not null),
  constraint deposits_returned_chk check (amount_returned = 0 or returned_at is not null),
  constraint deposits_retention_chk check (amount_retained = 0 or coalesce(trim(retention_reason), '') <> '')
);
create index deposits_status_idx on public.deposits(company_id, status);

-- ---------------------------------------------------------------------
-- Integração: veículo e financeiro (AFTER, SECURITY DEFINER)
-- ---------------------------------------------------------------------
create or replace function app.sync_rental_finance(p_rental_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_paid numeric;
  v_last date;
  v_status public.transaction_status;
  v_line text;
  v_amount numeric;
  v_category public.transaction_category;
begin
  select rt.*, v.plate into r
  from public.rentals rt join public.vehicles v on v.id = rt.vehicle_id
  where rt.id = p_rental_id;
  if not found then return; end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0), max(paid_at)
    into v_paid, v_last
  from public.rental_payments where rental_id = p_rental_id and voided_at is null;

  foreach v_line in array array['rental', 'extras', 'excess_mileage'] loop
    v_amount := case v_line
      when 'rental' then r.base_amount + r.extra_fees_amount - r.discount_amount
      when 'extras' then r.extras_amount
      else r.excess_mileage_amount end;
    v_category := case v_line when 'rental' then 'rental' when 'extras' then 'additional_fee' else 'excess_mileage' end;

    if r.status = 'reservation' or r.archived_at is not null or v_amount <= 0 then
      -- ainda não é receita (reserva) ou linha zerada: anula se existir
      update public.financial_transactions set status = 'cancelled', paid_at = null
       where rental_id = p_rental_id and rental_line = v_line and status <> 'cancelled';
      continue;
    end if;

    v_status := case when r.status = 'cancelled' then 'cancelled'
                     when v_paid >= r.total_amount then 'paid'
                     else 'pending' end;

    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, due_date, paid_at, status,
       vehicle_id, customer_id, rental_id, rental_line, created_by, updated_by)
    values
      (r.company_id, 'income', v_category, r.contract_number || ' · ' || r.plate, v_amount,
       (r.return_at at time zone 'Europe/Madrid')::date, (r.pickup_at at time zone 'Europe/Madrid')::date,
       case when v_status = 'paid' then coalesce(v_last, (now() at time zone 'Europe/Madrid')::date) end,
       v_status, r.vehicle_id, r.customer_id, r.id, v_line, auth.uid(), auth.uid())
    on conflict (rental_id, rental_line) where rental_line is not null do update
      set amount = excluded.amount, competence_date = excluded.competence_date, due_date = excluded.due_date,
          paid_at = excluded.paid_at, status = excluded.status, vehicle_id = excluded.vehicle_id,
          customer_id = excluded.customer_id, description = excluded.description
      where (ft.amount, ft.competence_date, ft.due_date, ft.paid_at, ft.status, ft.vehicle_id, ft.customer_id, ft.description)
            is distinct from
            (excluded.amount, excluded.competence_date, excluded.due_date, excluded.paid_at, excluded.status,
             excluded.vehicle_id, excluded.customer_id, excluded.description);
  end loop;
end;
$$;

create or replace function app.after_rental_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- entrega: veículo alugado e km atualizada
  if new.status in ('in_progress', 'late') and (tg_op = 'INSERT' or old.status not in ('in_progress', 'late')) then
    update public.vehicles
       set status = 'rented', current_mileage = greatest(current_mileage, coalesce(new.start_mileage, 0))
     where id = new.vehicle_id;
  end if;
  -- devolução: libera o veículo (se não houver outro contrato em andamento) e atualiza a km
  if tg_op = 'UPDATE' and old.status in ('in_progress', 'late') and new.status = 'completed' then
    update public.vehicles v
       set current_mileage = greatest(v.current_mileage, coalesce(new.end_mileage, 0)),
           status = case when v.status = 'rented' and not exists (
                            select 1 from public.rentals o where o.vehicle_id = v.id and o.id <> new.id
                              and o.status in ('in_progress', 'late') and o.archived_at is null)
                         then 'available'::public.vehicle_status else v.status end
     where v.id = new.vehicle_id;
  end if;

  perform app.sync_rental_finance(new.id);

  -- caução: cria o registro com o valor combinado (recebimento é lançado à parte)
  if new.deposit_amount > 0 and not exists (select 1 from public.deposits d where d.rental_id = new.id) then
    insert into public.deposits (company_id, rental_id, customer_id, vehicle_id, created_by, updated_by)
    values (new.company_id, new.id, new.customer_id, new.vehicle_id, auth.uid(), auth.uid());
  end if;
  return null;
end;
$$;

create trigger rentals_after_change after insert or update on public.rentals
  for each row execute function app.after_rental_change();

create or replace function app.after_payment_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.sync_rental_finance(coalesce(new.rental_id, old.rental_id));
  return null;
end;
$$;
create trigger rental_payments_sync after insert or update on public.rental_payments
  for each row execute function app.after_payment_change();

-- ---------------------------------------------------------------------
-- Auditoria, RLS e privilégios
-- ---------------------------------------------------------------------
create trigger rental_payments_audit before insert or update on public.rental_payments
  for each row execute function app.set_audit_fields();
create trigger deposits_audit before insert or update on public.deposits
  for each row execute function app.set_audit_fields();
create trigger rental_payments_log after insert or update or delete on public.rental_payments
  for each row execute function app.log_activity();
create trigger deposits_log after insert or update or delete on public.deposits
  for each row execute function app.log_activity();
create trigger rental_payments_no_hard_delete before delete on public.rental_payments
  for each row execute function app.prevent_hard_delete();
create trigger deposits_no_hard_delete before delete on public.deposits
  for each row execute function app.prevent_hard_delete();

alter table public.rental_extras enable row level security;
alter table public.rental_payments enable row level security;
alter table public.deposits enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['rental_extras', 'rental_payments', 'deposits'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using (company_id = app.current_company_id())
                    with check (company_id = app.current_company_id())', t);
  end loop;
end $$;
-- extras: a equipe remove itens de contratos abertos (a guarda bloqueia os fechados)
create policy rental_extras_delete on public.rental_extras for delete to authenticated
  using (company_id = app.current_company_id());
-- pagamentos e cauções: sem política de DELETE para a equipe (exclusão só com autorização especial)
create policy rental_payments_delete on public.rental_payments for delete to authenticated
  using (company_id = app.current_company_id() and app.is_owner());
create policy deposits_delete on public.deposits for delete to authenticated
  using (company_id = app.current_company_id() and app.is_owner());

grant select, insert, update, delete on public.rental_extras, public.rental_payments, public.deposits to authenticated;
revoke all on public.rental_extras, public.rental_payments, public.deposits from anon;

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
-- Resumo financeiro do contrato: total, pago, saldo e caução
create or replace function public.rental_balance(p_rental_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'total',    r.total_amount,
    'paid',     coalesce((select sum(case when kind = 'payment' then amount else -amount end)
                          from public.rental_payments where rental_id = r.id and voided_at is null), 0)::numeric(14,2),
    'balance',  (r.total_amount - coalesce((select sum(case when kind = 'payment' then amount else -amount end)
                          from public.rental_payments where rental_id = r.id and voided_at is null), 0))::numeric(14,2),
    'deposit_agreed',   r.deposit_amount,
    'deposit_received', coalesce(d.amount_received, 0),
    'deposit_returned', coalesce(d.amount_returned, 0),
    'deposit_retained', coalesce(d.amount_retained, 0),
    'deposit_balance',  coalesce(d.balance, 0),
    'deposit_status',   coalesce(d.status, 'not_received')
  )
  from public.rentals r
  left join public.deposits d on d.rental_id = r.id
  where r.id = p_rental_id;
$$;

-- Conflitos de agenda para a prévia do formulário (a garantia é a constraint EXCLUDE)
create or replace function public.vehicle_conflicts(p_vehicle_id uuid, p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns table (id uuid, contract_number text, status public.rental_status, pickup_at timestamptz, return_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select r.id, r.contract_number, r.status, r.pickup_at, r.return_at
  from public.rentals r
  where r.vehicle_id = p_vehicle_id
    and r.archived_at is null
    and r.status in ('reservation', 'confirmed', 'in_progress', 'late')
    and (p_exclude is null or r.id <> p_exclude)
    and tstzrange(r.pickup_at, r.return_at, '[)') && tstzrange(p_from, p_to, '[)')
  order by r.pickup_at
  limit 10;
$$;

-- Prévia de cálculo com as mesmas fórmulas do contrato (usada para conferência)
create or replace function public.rental_quote(
  p_pickup timestamptz, p_return timestamptz, p_mode public.rental_pricing_mode, p_unit numeric,
  p_policy public.mileage_policy, p_limit integer)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with g as (select coalesce((select rental_grace_minutes from public.companies where id = app.current_company_id()), 0) as grace),
  d as (select app.rental_charge_days(p_pickup, p_return, (select grace from g)) as days)
  select jsonb_build_object(
    'days', d.days,
    'base', app.rental_base_amount(p_mode, p_unit, d.days),
    'allowed_km', app.rental_allowed_km(p_policy, p_limit, d.days),
    'grace_minutes', (select grace from g)
  ) from d;
$$;

revoke all on function public.rental_balance(uuid) from public, anon;
revoke all on function public.vehicle_conflicts(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.rental_quote(timestamptz, timestamptz, public.rental_pricing_mode, numeric, public.mileage_policy, integer) from public, anon;
grant execute on function public.rental_balance(uuid) to authenticated;
grant execute on function public.vehicle_conflicts(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.rental_quote(timestamptz, timestamptz, public.rental_pricing_mode, numeric, public.mileage_policy, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Dashboard: reservados = disponíveis com retirada nas próximas 48 h
-- (ou marcados manualmente); cauções em aberto; novos alertas
-- ---------------------------------------------------------------------
create or replace function public.dashboard_kpis(p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with v as (
    select vv.id, vv.status,
           (vv.status = 'available' and exists (
              select 1 from public.rentals r where r.vehicle_id = vv.id and r.archived_at is null
                and r.status in ('reservation', 'confirmed')
                and r.pickup_at < now() + interval '48 hours' and r.return_at > now())) as soon
    from public.vehicles vv where vv.archived_at is null and vv.status <> 'sold'
  ),
  ft as (
    select type, amount from public.financial_transactions
    where archived_at is null and status <> 'cancelled' and is_operational
      and competence_date between p_from and p_to
  ),
  totals as (
    select coalesce(sum(amount) filter (where type = 'income'), 0)::numeric(14,2) as revenue,
           coalesce(sum(amount) filter (where type = 'expense'), 0)::numeric(14,2) as expenses
    from ft
  )
  select jsonb_build_object(
    'vehicles_total',       (select count(*) from v),
    'vehicles_available',   (select count(*) from v where status = 'available' and not soon),
    'vehicles_rented',      (select count(*) from v where status = 'rented'),
    'vehicles_reserved',    (select count(*) from v where status = 'reserved' or soon),
    'vehicles_maintenance', (select count(*) from v where status = 'maintenance'),
    'revenue',              (select revenue from totals),
    'expenses',             (select expenses from totals),
    'operating_profit',     (select revenue - expenses from totals),
    'active_contracts',     (select count(*) from public.rentals
                              where archived_at is null and status in ('confirmed', 'in_progress', 'late')),
    'upcoming_returns',     (select count(*) from public.rentals
                              where archived_at is null and status in ('in_progress', 'late')
                                and return_at < now() + interval '7 days'),
    'insurance_expiring',   (select count(*) from public.insurance_policies ip
                              where ip.archived_at is null
                                and ip.end_date <= (now() at time zone 'Europe/Madrid')::date + 30
                                and not exists (select 1 from public.insurance_policies n
                                                where n.renewed_from_id = ip.id and n.archived_at is null)),
    'documents_expiring',   (select count(*) from public.documents
                              where archived_at is null and expires_at is not null
                                and expires_at <= (now() at time zone 'Europe/Madrid')::date + 30)
                            + (select count(*) from public.vehicles
                              where archived_at is null and status <> 'sold' and itv_due_date is not null
                                and itv_due_date <= (now() at time zone 'Europe/Madrid')::date + 30),
    'deposits_held',        (select count(*) from public.deposits where status = 'held'),
    'deposits_held_amount', coalesce((select sum(balance) from public.deposits where status = 'held'), 0)::numeric(14,2)
  );
$$;

create or replace function public.dashboard_alerts(p_limit integer default 20)
returns table (kind text, severity text, entity text, entity_id uuid, title text, due_date date)
language sql stable security invoker set search_path = ''
as $$
  with today as (select (now() at time zone 'Europe/Madrid')::date as d),
  a as (
    select 'rental_overdue'::text as kind, 'critical'::text as severity, 'rentals'::text as entity, r.id,
           r.contract_number || ' · ' || v.plate as title,
           (r.return_at at time zone 'Europe/Madrid')::date as due
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('in_progress', 'late') and r.return_at < now()
    union all
    select 'rental_return_soon', 'info', 'rentals', r.id, r.contract_number || ' · ' || v.plate,
           (r.return_at at time zone 'Europe/Madrid')::date
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('in_progress', 'late')
      and r.return_at >= now() and r.return_at < now() + interval '3 days'
    union all
    select 'rental_pickup_soon', 'info', 'rentals', r.id, r.contract_number || ' · ' || v.plate,
           (r.pickup_at at time zone 'Europe/Madrid')::date
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('reservation', 'confirmed')
      and r.pickup_at >= now() - interval '1 day' and r.pickup_at < now() + interval '3 days'
    union all
    select case when ip.end_date < t.d then 'insurance_expired' else 'insurance_expiring' end,
           case when ip.end_date < t.d then 'critical' when ip.end_date <= t.d + 7 then 'high'
                when ip.end_date <= t.d + 15 then 'medium' else 'low' end,
           'insurance_policies', ip.id, ip.insurer || ' · ' || v.plate, ip.end_date
    from public.insurance_policies ip join public.vehicles v on v.id = ip.vehicle_id cross join today t
    where ip.archived_at is null and v.archived_at is null and v.status <> 'sold' and ip.end_date <= t.d + 30
      and not exists (select 1 from public.insurance_policies n where n.renewed_from_id = ip.id and n.archived_at is null)
    union all
    select case when v.itv_due_date < t.d then 'itv_expired' else 'itv_expiring' end,
           case when v.itv_due_date < t.d then 'critical' when v.itv_due_date <= t.d + 7 then 'high'
                when v.itv_due_date <= t.d + 15 then 'medium' else 'low' end,
           'vehicles', v.id, v.brand || ' ' || v.model || ' · ' || v.plate, v.itv_due_date
    from public.vehicles v cross join today t
    where v.archived_at is null and v.status <> 'sold' and v.itv_due_date is not null and v.itv_due_date <= t.d + 30
    union all
    select case when d.expires_at < t.d then 'document_expired' else 'document_expiring' end,
           case when d.expires_at < t.d then 'critical' when d.expires_at <= t.d + 7 then 'high' else 'medium' end,
           'documents', d.id, d.title, d.expires_at
    from public.documents d cross join today t
    where d.archived_at is null and d.expires_at is not null and d.expires_at <= t.d + 30
    union all
    select 'payment_overdue', 'high', 'financial_transactions', f.id, f.description, f.due_date
    from public.financial_transactions f cross join today t
    where f.archived_at is null and f.status = 'pending' and f.due_date is not null and f.due_date < t.d
    union all
    select 'deposit_pending', 'medium', 'deposits', dp.id, r.contract_number || ' · ' || v.plate,
           (r.actual_return_at at time zone 'Europe/Madrid')::date
    from public.deposits dp join public.rentals r on r.id = dp.rental_id join public.vehicles v on v.id = dp.vehicle_id
    where dp.status = 'held' and r.status = 'completed'
  )
  select kind, severity, entity, id, title, due
  from a
  order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end,
           due nulls last
  limit greatest(1, least(p_limit, 100));
$$;

-- ---------------------------------------------------------------------
-- Salvar contrato + extras numa única transação (tudo ou nada)
-- ---------------------------------------------------------------------
create or replace function public.save_rental(p_id uuid, p_data jsonb, p_extras jsonb default '[]'::jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_status public.rental_status;
begin
  if p_id is null then
    insert into public.rentals (
      customer_id, vehicle_id, status, pickup_at, return_at, pricing_mode, unit_price, discount_amount,
      extra_fees_amount, deposit_amount, payment_method, mileage_policy, mileage_limit_km, excess_km_price,
      contract_locale, pickup_location, return_location, notes)
    values (
      (p_data ->> 'customer_id')::uuid, (p_data ->> 'vehicle_id')::uuid,
      coalesce(p_data ->> 'status', 'confirmed')::public.rental_status,
      (p_data ->> 'pickup_at')::timestamptz, (p_data ->> 'return_at')::timestamptz,
      (p_data ->> 'pricing_mode')::public.rental_pricing_mode, (p_data ->> 'unit_price')::numeric,
      coalesce((p_data ->> 'discount_amount')::numeric, 0), coalesce((p_data ->> 'extra_fees_amount')::numeric, 0),
      coalesce((p_data ->> 'deposit_amount')::numeric, 0), (p_data ->> 'payment_method')::public.payment_method,
      (p_data ->> 'mileage_policy')::public.mileage_policy, (p_data ->> 'mileage_limit_km')::integer,
      (p_data ->> 'excess_km_price')::numeric, coalesce(p_data ->> 'contract_locale', 'es-ES'),
      p_data ->> 'pickup_location', p_data ->> 'return_location', p_data ->> 'notes')
    returning id into v_id;
  else
    select status into v_status from public.rentals where id = p_id;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_status in ('completed', 'cancelled') then
      raise exception 'RENTAL_LOCKED' using errcode = 'P0001';
    end if;
    update public.rentals set
      customer_id = (p_data ->> 'customer_id')::uuid, vehicle_id = (p_data ->> 'vehicle_id')::uuid,
      pickup_at = (p_data ->> 'pickup_at')::timestamptz, return_at = (p_data ->> 'return_at')::timestamptz,
      pricing_mode = (p_data ->> 'pricing_mode')::public.rental_pricing_mode, unit_price = (p_data ->> 'unit_price')::numeric,
      discount_amount = coalesce((p_data ->> 'discount_amount')::numeric, 0),
      extra_fees_amount = coalesce((p_data ->> 'extra_fees_amount')::numeric, 0),
      deposit_amount = coalesce((p_data ->> 'deposit_amount')::numeric, 0),
      payment_method = (p_data ->> 'payment_method')::public.payment_method,
      mileage_policy = (p_data ->> 'mileage_policy')::public.mileage_policy,
      mileage_limit_km = (p_data ->> 'mileage_limit_km')::integer, excess_km_price = (p_data ->> 'excess_km_price')::numeric,
      contract_locale = coalesce(p_data ->> 'contract_locale', contract_locale),
      pickup_location = p_data ->> 'pickup_location', return_location = p_data ->> 'return_location', notes = p_data ->> 'notes'
    where id = p_id;
    delete from public.rental_extras where rental_id = p_id;
  end if;

  insert into public.rental_extras (rental_id, fee_id, name, amount, charge_type, quantity)
  select v_id, nullif(e ->> 'fee_id', '')::uuid, e ->> 'name', (e ->> 'amount')::numeric,
         coalesce(e ->> 'charge_type', 'per_rental')::public.fee_charge_type, coalesce((e ->> 'quantity')::integer, 1)
  from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) e;

  return v_id;
end;
$$;
revoke all on function public.save_rental(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_rental(uuid, jsonb, jsonb) to authenticated;
