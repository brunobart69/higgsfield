-- =====================================================================
-- JB RENT PRO — Migration 0007: manutenção, multas e sinistros
-- ---------------------------------------------------------------------
--   * planos de manutenção por data e/ou km, com vencimento calculado
--   * ordens de manutenção: agendada → em andamento → concluída/cancelada;
--     bloqueia o veículo enquanto em andamento, atualiza km e plano,
--     resolve a avaria ligada e lança a despesa no financeiro
--   * multas: contrato/cliente identificados pela data e hora da infração,
--     prazos de identificação e pagamento, pagamento e repasse ao cliente
--   * sinistros: contrato, apólice vigente, terceiros, polícia, franquia
--     cobrada do cliente e indenização da seguradora
-- =====================================================================

-- ---------------------------------------------------------------------
-- Financeiro: receitas novas e vínculos de origem
-- ---------------------------------------------------------------------
alter table public.financial_transactions drop constraint ft_category_type_chk;
alter table public.financial_transactions add constraint ft_category_type_chk check (
  (type = 'income' and category in ('rental', 'additional_fee', 'excess_mileage', 'extra_service', 'other_income', 'fine_recharge', 'damage_recovery'))
  or (type = 'expense' and category not in ('rental', 'additional_fee', 'excess_mileage', 'extra_service', 'other_income', 'fine_recharge', 'damage_recovery'))
);
-- chave da origem automática (ex.: "fine:<id>:expense"), garante um lançamento por origem
alter table public.financial_transactions add column source_ref text;
create unique index ft_source_ref_uidx on public.financial_transactions(source_ref) where source_ref is not null;

-- Contrato em andamento num instante (para multas e sinistros)
create or replace function app.rental_at(p_vehicle uuid, p_at timestamptz)
returns table (rental_id uuid, customer_id uuid)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.customer_id
  from public.rentals r
  where r.vehicle_id = p_vehicle and r.archived_at is null
    and r.company_id = app.current_company_id()
    and r.status in ('in_progress', 'late', 'completed')
    and coalesce(r.picked_up_at, r.pickup_at) <= p_at
    and coalesce(r.actual_return_at, case when r.status = 'completed' then r.return_at else 'infinity'::timestamptz end) >= p_at
  order by coalesce(r.picked_up_at, r.pickup_at) desc
  limit 1
$$;

create type public.maintenance_type as enum
  ('preventive', 'oil_change', 'tyres', 'brakes', 'itv', 'repair', 'bodywork', 'cleaning', 'other');
create type public.maintenance_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled');
create type public.fine_status as enum ('pending', 'driver_identified', 'paid', 'appealed', 'cancelled');
create type public.accident_status as enum ('reported', 'under_review', 'in_repair', 'closed', 'rejected');
create type public.accident_fault as enum ('own', 'third_party', 'shared', 'unknown');

-- ---------------------------------------------------------------------
-- Planos de manutenção
-- ---------------------------------------------------------------------
create table public.maintenance_plans (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id         uuid not null references public.vehicles(id) on delete restrict,
  name               text not null check (length(trim(name)) between 2 and 120),
  maintenance_type   public.maintenance_type not null default 'preventive',
  interval_km        integer check (interval_km is null or interval_km between 100 and 500000),
  interval_months    smallint check (interval_months is null or interval_months between 1 and 120),
  last_done_date     date,
  last_done_mileage  integer check (last_done_mileage is null or last_done_mileage >= 0),
  notes              text check (notes is null or length(notes) <= 2000),
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  updated_by         uuid references auth.users(id) on delete set null,
  constraint mp_interval_chk check (interval_km is not null or interval_months is not null),
  constraint mp_base_chk check ((interval_months is null or last_done_date is not null)
                                and (interval_km is null or last_done_mileage is not null))
);
create index maintenance_plans_vehicle_idx on public.maintenance_plans(vehicle_id) where archived_at is null;

-- ---------------------------------------------------------------------
-- Ordens de manutenção
-- ---------------------------------------------------------------------
create table public.maintenance_records (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id        uuid not null references public.vehicles(id) on delete restrict,
  plan_id           uuid references public.maintenance_plans(id) on delete restrict,
  damage_id         uuid references public.damages(id) on delete restrict,
  maintenance_type  public.maintenance_type not null,
  status            public.maintenance_status not null default 'scheduled',
  title             text not null check (length(trim(title)) between 2 and 160),
  description       text check (description is null or length(description) <= 4000),
  scheduled_date    date,
  started_at        date,
  completed_date    date,
  mileage           integer check (mileage is null or mileage >= 0),
  workshop          text check (workshop is null or length(workshop) <= 160),
  cost              numeric(12,2) check (cost is null or cost >= 0),
  invoice_number    text check (invoice_number is null or length(invoice_number) <= 60),
  paid_at           date,
  payment_method    public.payment_method,
  blocks_vehicle    boolean not null default true,
  cancel_reason     text check (cancel_reason is null or length(cancel_reason) <= 500),
  notes             text check (notes is null or length(notes) <= 4000),
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null,
  updated_by        uuid references auth.users(id) on delete set null,
  constraint mr_paid_chk check (paid_at is null or coalesce(cost, 0) > 0),
  constraint mr_completed_chk check (status <> 'completed' or completed_date is not null),
  constraint mr_scheduled_chk check (status <> 'scheduled' or scheduled_date is not null)
);
create index maintenance_records_vehicle_idx on public.maintenance_records(vehicle_id, status) where archived_at is null;
create index maintenance_records_company_idx on public.maintenance_records(company_id, status, scheduled_date) where archived_at is null;
create index maintenance_records_damage_idx on public.maintenance_records(damage_id);

create or replace function app.guard_maintenance()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  select company_id, status into r from public.vehicles where id = new.vehicle_id;
  if not found or r.company_id <> new.company_id then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = '23503';
  end if;
  if new.plan_id is not null and not exists (select 1 from public.maintenance_plans p where p.id = new.plan_id and p.vehicle_id = new.vehicle_id) then
    raise exception 'MAINTENANCE_LINK_MISMATCH: plan of another vehicle' using errcode = 'P0001';
  end if;
  if new.damage_id is not null and not exists (select 1 from public.damages d where d.id = new.damage_id and d.vehicle_id = new.vehicle_id) then
    raise exception 'MAINTENANCE_LINK_MISMATCH: damage of another vehicle' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('completed', 'cancelled') then
      -- concluída/cancelada: só pagamento, fatura, custo e observações podem mudar
      if (new.status, new.vehicle_id, new.maintenance_type, new.completed_date, new.mileage, new.plan_id, new.damage_id)
         is distinct from (old.status, old.vehicle_id, old.maintenance_type, old.completed_date, old.mileage, old.plan_id, old.damage_id) then
        raise exception 'MAINTENANCE_LOCKED' using errcode = 'P0001';
      end if;
      if old.status = 'cancelled' and (new.cost, new.paid_at) is distinct from (old.cost, old.paid_at) then
        raise exception 'MAINTENANCE_LOCKED' using errcode = 'P0001';
      end if;
    elsif old.status = 'in_progress' and new.status = 'scheduled' then
      raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'in_progress' and (tg_op = 'INSERT' or old.status <> 'in_progress') then
    new.started_at := coalesce(new.started_at, (now() at time zone 'Europe/Madrid')::date);
    if new.blocks_vehicle and exists (select 1 from public.rentals x where x.vehicle_id = new.vehicle_id
                                        and x.status in ('in_progress', 'late') and x.archived_at is null) then
      raise exception 'VEHICLE_BUSY: vehicle is rented' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_date := coalesce(new.completed_date, (now() at time zone 'Europe/Madrid')::date);
    if new.plan_id is not null and new.mileage is null
       and (select interval_km from public.maintenance_plans where id = new.plan_id) is not null then
      raise exception 'MAINTENANCE_DATA_REQUIRED: mileage required for km-based plans' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status <> 'cancelled') and coalesce(trim(new.cancel_reason), '') = '' then
    raise exception 'CANCEL_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger maintenance_records_guard before insert or update on public.maintenance_records
  for each row execute function app.guard_maintenance();

create or replace function app.after_maintenance_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_plate text;
  v_cat public.transaction_category;
begin
  -- veículo em oficina
  if new.status = 'in_progress' and new.blocks_vehicle and (tg_op = 'INSERT' or old.status <> 'in_progress') then
    update public.vehicles set status = 'maintenance' where id = new.vehicle_id and status in ('available', 'reserved');
  end if;
  -- saiu da oficina: libera se não houver outra manutenção bloqueante
  if tg_op = 'UPDATE' and old.status = 'in_progress' and new.status in ('completed', 'cancelled') then
    update public.vehicles v set status = 'available'
     where v.id = new.vehicle_id and v.status = 'maintenance'
       and not exists (select 1 from public.maintenance_records o where o.vehicle_id = v.id and o.id <> new.id
                         and o.status = 'in_progress' and o.blocks_vehicle and o.archived_at is null);
  end if;

  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    if new.mileage is not null then
      update public.vehicles set current_mileage = greatest(current_mileage, new.mileage) where id = new.vehicle_id;
    end if;
    if new.plan_id is not null then
      update public.maintenance_plans p
         set last_done_date = greatest(coalesce(p.last_done_date, new.completed_date), new.completed_date),
             last_done_mileage = case when new.mileage is null then p.last_done_mileage
                                      else greatest(coalesce(p.last_done_mileage, new.mileage), new.mileage) end
       where p.id = new.plan_id;
    end if;
    if new.damage_id is not null then
      update public.damages
         set status = 'resolved', resolved_at = new.completed_date,
             actual_cost = coalesce(new.cost, actual_cost),
             repair_shop = coalesce(new.workshop, repair_shop)
       where id = new.damage_id and status <> 'resolved';
    end if;
  end if;
  if new.damage_id is not null and new.status = 'in_progress' and (tg_op = 'INSERT' or old.status <> 'in_progress') then
    update public.damages set status = 'in_repair' where id = new.damage_id and status = 'pending';
  end if;

  -- despesa (competência na conclusão)
  if new.status = 'completed' and new.archived_at is null and coalesce(new.cost, 0) > 0 then
    v_cat := case new.maintenance_type
               when 'tyres' then 'tyres' when 'itv' then 'itv' when 'cleaning' then 'cleaning'
               when 'repair' then 'repairs' when 'bodywork' then 'repairs'
               else 'maintenance' end;
    select plate into v_plate from public.vehicles where id = new.vehicle_id;
    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, due_date, paid_at, status,
       payment_method, vehicle_id, source_ref, created_by, updated_by)
    values (new.company_id, 'expense', v_cat, new.title || ' · ' || v_plate || coalesce(' · ' || new.workshop, ''),
            new.cost, new.completed_date, new.completed_date, new.paid_at,
            case when new.paid_at is not null then 'paid'::public.transaction_status else 'pending' end,
            new.payment_method, new.vehicle_id, 'maintenance:' || new.id, auth.uid(), auth.uid())
    on conflict (source_ref) where source_ref is not null do update
      set category = excluded.category, description = excluded.description, amount = excluded.amount,
          competence_date = excluded.competence_date, due_date = excluded.due_date, paid_at = excluded.paid_at,
          status = excluded.status, payment_method = excluded.payment_method
      where (ft.category, ft.description, ft.amount, ft.competence_date, ft.paid_at, ft.status, ft.payment_method)
            is distinct from (excluded.category, excluded.description, excluded.amount, excluded.competence_date,
                              excluded.paid_at, excluded.status, excluded.payment_method);
  else
    update public.financial_transactions set status = 'cancelled', paid_at = null
     where source_ref = 'maintenance:' || new.id and status <> 'cancelled';
  end if;
  return null;
end;
$$;
create trigger maintenance_records_after after insert or update on public.maintenance_records
  for each row execute function app.after_maintenance_change();

-- Vencimento dos planos (data e/ou km). "Em breve": até p_days dias ou p_km km.
create or replace function public.maintenance_due(p_days integer default 30, p_km integer default 1000)
returns table (plan_id uuid, vehicle_id uuid, vehicle text, name text, maintenance_type public.maintenance_type,
               next_date date, next_km integer, current_km integer, days_left integer, km_left integer, due_status text)
language sql stable security invoker set search_path = ''
as $$
  with t as (select (now() at time zone 'Europe/Madrid')::date as d),
  p as (
    select mp.*, v.current_mileage, v.brand || ' ' || v.model || ' · ' || v.plate as vlabel,
           case when mp.interval_months is not null then (mp.last_done_date + make_interval(months => mp.interval_months))::date end as nd,
           case when mp.interval_km is not null then mp.last_done_mileage + mp.interval_km end as nk
    from public.maintenance_plans mp join public.vehicles v on v.id = mp.vehicle_id
    where mp.archived_at is null and v.archived_at is null and v.status <> 'sold'
  )
  , res as (
    select p.id, p.vehicle_id, p.vlabel, p.name, p.maintenance_type, p.nd, p.nk, p.current_mileage,
           (p.nd - t.d)::integer as dl, (p.nk - p.current_mileage)::integer as kl,
           case when (p.nd is not null and p.nd < t.d) or (p.nk is not null and p.current_mileage >= p.nk) then 'overdue'
                when (p.nd is not null and p.nd <= t.d + p_days) or (p.nk is not null and p.nk - p.current_mileage <= p_km) then 'due_soon'
                else 'ok' end as st
    from p cross join t
  )
  select * from res
  order by case st when 'overdue' then 0 when 'due_soon' then 1 else 2 end,
           least(coalesce(dl, 99999), coalesce(kl / 50, 99999))
$$;
revoke all on function public.maintenance_due(integer, integer) from public, anon;
grant execute on function public.maintenance_due(integer, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Multas
-- ---------------------------------------------------------------------
create table public.traffic_fines (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id               uuid not null references public.vehicles(id) on delete restrict,
  rental_id                uuid references public.rentals(id) on delete restrict,
  customer_id              uuid references public.customers(id) on delete restrict,
  infraction_at            timestamptz not null,
  authority                text not null check (length(trim(authority)) between 2 and 160),
  reference                text check (reference is null or length(reference) <= 80),
  infraction               text not null check (length(trim(infraction)) between 3 and 1000),
  location                 text check (location is null or length(location) <= 200),
  points                   smallint check (points is null or points between 0 and 15),
  amount                   numeric(12,2) not null check (amount > 0),
  notified_at              date,
  identification_deadline  date,
  payment_deadline         date,
  status                   public.fine_status not null default 'pending',
  identified_at            date,
  paid_at                  date,
  paid_amount              numeric(12,2) check (paid_amount is null or paid_amount > 0),
  payment_method           public.payment_method,
  recharge_amount          numeric(12,2) check (recharge_amount is null or recharge_amount >= 0),
  recharge_paid_at         date,
  notes                    text check (notes is null or length(notes) <= 4000),
  archived_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id) on delete set null,
  updated_by               uuid references auth.users(id) on delete set null,
  constraint tf_paid_chk check (status <> 'paid' or paid_at is not null),
  constraint tf_recharge_paid_chk check (recharge_paid_at is null or coalesce(recharge_amount, 0) > 0)
);
create unique index traffic_fines_reference_uidx on public.traffic_fines(company_id, upper(reference))
  where reference is not null and archived_at is null;
create index traffic_fines_company_idx on public.traffic_fines(company_id, status, infraction_at desc) where archived_at is null;
create index traffic_fines_vehicle_idx on public.traffic_fines(vehicle_id);
create index traffic_fines_customer_idx on public.traffic_fines(customer_id);
create index traffic_fines_rental_idx on public.traffic_fines(rental_id);

create or replace function app.guard_fine()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.company_id = new.company_id) then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = '23503';
  end if;
  new.reference := nullif(upper(trim(new.reference)), '');
  -- contrato vigente no momento da infração (quando não informado)
  if new.rental_id is null and (tg_op = 'INSERT' or new.infraction_at is distinct from old.infraction_at or new.vehicle_id is distinct from old.vehicle_id) then
    select * into r from app.rental_at(new.vehicle_id, new.infraction_at);
    if found then
      new.rental_id := r.rental_id;
      new.customer_id := coalesce(new.customer_id, r.customer_id);
    end if;
  elsif new.rental_id is not null then
    select vehicle_id, customer_id, company_id into r from public.rentals where id = new.rental_id;
    if not found or r.company_id <> new.company_id or r.vehicle_id <> new.vehicle_id then
      raise exception 'FINE_RENTAL_MISMATCH' using errcode = 'P0001';
    end if;
    new.customer_id := coalesce(new.customer_id, r.customer_id);
  end if;
  if new.customer_id is not null and not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = '23503';
  end if;

  if new.status = 'driver_identified' then
    if new.customer_id is null then
      raise exception 'FINE_NO_DRIVER: identify the customer first' using errcode = 'P0001';
    end if;
    new.identified_at := coalesce(new.identified_at, (now() at time zone 'Europe/Madrid')::date);
  end if;
  if new.status = 'paid' then
    new.paid_amount := coalesce(new.paid_amount, new.amount);
  end if;
  if coalesce(new.recharge_amount, 0) > 0 and new.customer_id is null then
    raise exception 'FINE_NO_DRIVER: recharge needs a customer' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger traffic_fines_guard before insert or update on public.traffic_fines
  for each row execute function app.guard_fine();

create or replace function app.after_fine_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_plate text;
  v_desc text;
  v_comp date := (new.infraction_at at time zone 'Europe/Madrid')::date;
begin
  select plate into v_plate from public.vehicles where id = new.vehicle_id;
  v_desc := new.authority || coalesce(' · ' || new.reference, '') || ' · ' || v_plate;

  -- multa paga pela empresa → despesa
  if new.archived_at is null and new.status <> 'cancelled' and new.paid_at is not null and coalesce(new.paid_amount, 0) > 0 then
    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, due_date, paid_at, status, payment_method,
       vehicle_id, customer_id, rental_id, source_ref, created_by, updated_by)
    values (new.company_id, 'expense', 'fines', v_desc, new.paid_amount, v_comp, new.payment_deadline, new.paid_at, 'paid',
            new.payment_method, new.vehicle_id, new.customer_id, new.rental_id, 'fine:' || new.id || ':expense', auth.uid(), auth.uid())
    on conflict (source_ref) where source_ref is not null do update
      set amount = excluded.amount, competence_date = excluded.competence_date, due_date = excluded.due_date,
          paid_at = excluded.paid_at, status = excluded.status, payment_method = excluded.payment_method,
          customer_id = excluded.customer_id, rental_id = excluded.rental_id, description = excluded.description
      where (ft.amount, ft.competence_date, ft.paid_at, ft.status, ft.payment_method, ft.customer_id, ft.rental_id, ft.description)
            is distinct from (excluded.amount, excluded.competence_date, excluded.paid_at, excluded.status, excluded.payment_method,
                              excluded.customer_id, excluded.rental_id, excluded.description);
  else
    update public.financial_transactions set status = 'cancelled', paid_at = null
     where source_ref = 'fine:' || new.id || ':expense' and status <> 'cancelled';
  end if;

  -- repasse ao cliente → receita "Repasse de multas"
  if new.archived_at is null and new.status <> 'cancelled' and coalesce(new.recharge_amount, 0) > 0 then
    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, due_date, paid_at, status,
       vehicle_id, customer_id, rental_id, source_ref, created_by, updated_by)
    values (new.company_id, 'income', 'fine_recharge', v_desc, new.recharge_amount, coalesce(new.notified_at, v_comp),
            null, new.recharge_paid_at,
            case when new.recharge_paid_at is not null then 'paid'::public.transaction_status else 'pending' end,
            new.vehicle_id, new.customer_id, new.rental_id, 'fine:' || new.id || ':recharge', auth.uid(), auth.uid())
    on conflict (source_ref) where source_ref is not null do update
      set amount = excluded.amount, competence_date = excluded.competence_date, paid_at = excluded.paid_at,
          status = excluded.status, customer_id = excluded.customer_id, rental_id = excluded.rental_id, description = excluded.description
      where (ft.amount, ft.competence_date, ft.paid_at, ft.status, ft.customer_id, ft.rental_id, ft.description)
            is distinct from (excluded.amount, excluded.competence_date, excluded.paid_at, excluded.status,
                              excluded.customer_id, excluded.rental_id, excluded.description);
  else
    update public.financial_transactions set status = 'cancelled', paid_at = null
     where source_ref = 'fine:' || new.id || ':recharge' and status <> 'cancelled';
  end if;
  return null;
end;
$$;
create trigger traffic_fines_after after insert or update on public.traffic_fines
  for each row execute function app.after_fine_change();

-- ---------------------------------------------------------------------
-- Sinistros
-- ---------------------------------------------------------------------
create table public.accidents (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id              uuid not null references public.vehicles(id) on delete restrict,
  rental_id               uuid references public.rentals(id) on delete restrict,
  customer_id             uuid references public.customers(id) on delete restrict,
  insurance_policy_id     uuid references public.insurance_policies(id) on delete restrict,
  occurred_at             timestamptz not null,
  location                text check (location is null or length(location) <= 200),
  description             text not null check (length(trim(description)) between 3 and 4000),
  status                  public.accident_status not null default 'reported',
  fault                   public.accident_fault not null default 'unknown',
  injuries                boolean not null default false,
  third_party             boolean not null default false,
  third_party_details     text check (third_party_details is null or length(third_party_details) <= 2000),
  police_report           boolean not null default false,
  police_report_number    text check (police_report_number is null or length(police_report_number) <= 80),
  amicable_report         boolean not null default false,
  insurer_claim_number    text check (insurer_claim_number is null or length(insurer_claim_number) <= 80),
  reported_to_insurer_at  date,
  estimated_cost          numeric(12,2) check (estimated_cost is null or estimated_cost >= 0),
  deductible_amount       numeric(12,2) check (deductible_amount is null or deductible_amount >= 0),
  deductible_paid_at      date,
  insurer_payout          numeric(12,2) check (insurer_payout is null or insurer_payout >= 0),
  insurer_payout_at       date,
  closed_at               date,
  notes                   text check (notes is null or length(notes) <= 4000),
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id) on delete set null,
  updated_by              uuid references auth.users(id) on delete set null,
  constraint acc_deductible_chk check (deductible_paid_at is null or coalesce(deductible_amount, 0) > 0),
  constraint acc_payout_chk check (insurer_payout_at is null or coalesce(insurer_payout, 0) > 0)
);
create index accidents_company_idx on public.accidents(company_id, status, occurred_at desc) where archived_at is null;
create index accidents_vehicle_idx on public.accidents(vehicle_id);
create index accidents_customer_idx on public.accidents(customer_id);
create index accidents_rental_idx on public.accidents(rental_id);

alter table public.damages add column accident_id uuid references public.accidents(id) on delete set null;
create index damages_accident_idx on public.damages(accident_id);

create or replace function app.guard_accident()
returns trigger
language plpgsql
as $$
declare
  r record;
  v_day date := (new.occurred_at at time zone 'Europe/Madrid')::date;
begin
  if not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.company_id = new.company_id) then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = '23503';
  end if;
  if new.rental_id is null and (tg_op = 'INSERT' or new.occurred_at is distinct from old.occurred_at or new.vehicle_id is distinct from old.vehicle_id) then
    select * into r from app.rental_at(new.vehicle_id, new.occurred_at);
    if found then
      new.rental_id := r.rental_id;
      new.customer_id := coalesce(new.customer_id, r.customer_id);
    end if;
  elsif new.rental_id is not null then
    select vehicle_id, customer_id, company_id into r from public.rentals where id = new.rental_id;
    if not found or r.company_id <> new.company_id or r.vehicle_id <> new.vehicle_id then
      raise exception 'ACCIDENT_RENTAL_MISMATCH' using errcode = 'P0001';
    end if;
    new.customer_id := coalesce(new.customer_id, r.customer_id);
  end if;
  if new.customer_id is not null and not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = '23503';
  end if;
  -- apólice vigente na data
  if new.insurance_policy_id is null then
    select ip.id into new.insurance_policy_id from public.insurance_policies ip
     where ip.vehicle_id = new.vehicle_id and ip.archived_at is null and ip.start_date <= v_day and ip.end_date >= v_day
     order by ip.start_date desc limit 1;
  elsif not exists (select 1 from public.insurance_policies ip where ip.id = new.insurance_policy_id and ip.vehicle_id = new.vehicle_id) then
    raise exception 'ACCIDENT_POLICY_MISMATCH' using errcode = 'P0001';
  end if;
  if coalesce(new.deductible_amount, 0) > 0 and new.customer_id is null then
    raise exception 'ACCIDENT_NO_CUSTOMER: deductible needs a customer' using errcode = 'P0001';
  end if;
  if new.status in ('closed', 'rejected') then
    new.closed_at := coalesce(new.closed_at, (now() at time zone 'Europe/Madrid')::date);
  else
    new.closed_at := null;
  end if;
  if new.police_report_number is not null and trim(new.police_report_number) <> '' then
    new.police_report := true;
  end if;
  return new;
end;
$$;
create trigger accidents_guard before insert or update on public.accidents
  for each row execute function app.guard_accident();

create or replace function app.after_accident_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_plate text;
  v_comp date := (new.occurred_at at time zone 'Europe/Madrid')::date;
  v_active boolean := new.archived_at is null and new.status <> 'rejected';
begin
  select plate into v_plate from public.vehicles where id = new.vehicle_id;
  -- franquia cobrada do cliente
  if v_active and coalesce(new.deductible_amount, 0) > 0 then
    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, paid_at, status,
       vehicle_id, customer_id, rental_id, source_ref, created_by, updated_by)
    values (new.company_id, 'income', 'damage_recovery', 'Franquicia · ' || v_plate, new.deductible_amount, v_comp,
            new.deductible_paid_at, case when new.deductible_paid_at is not null then 'paid'::public.transaction_status else 'pending' end,
            new.vehicle_id, new.customer_id, new.rental_id, 'accident:' || new.id || ':deductible', auth.uid(), auth.uid())
    on conflict (source_ref) where source_ref is not null do update
      set amount = excluded.amount, competence_date = excluded.competence_date, paid_at = excluded.paid_at,
          status = excluded.status, customer_id = excluded.customer_id, rental_id = excluded.rental_id
      where (ft.amount, ft.competence_date, ft.paid_at, ft.status, ft.customer_id, ft.rental_id)
            is distinct from (excluded.amount, excluded.competence_date, excluded.paid_at, excluded.status, excluded.customer_id, excluded.rental_id);
  else
    update public.financial_transactions set status = 'cancelled', paid_at = null
     where source_ref = 'accident:' || new.id || ':deductible' and status <> 'cancelled';
  end if;
  -- indenização recebida da seguradora (registrada quando recebida)
  if v_active and new.insurer_payout_at is not null and coalesce(new.insurer_payout, 0) > 0 then
    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, paid_at, status,
       vehicle_id, source_ref, created_by, updated_by)
    values (new.company_id, 'income', 'damage_recovery', 'Indemnización' || coalesce(' · ' || new.insurer_claim_number, '') || ' · ' || v_plate,
            new.insurer_payout, new.insurer_payout_at, new.insurer_payout_at, 'paid',
            new.vehicle_id, 'accident:' || new.id || ':payout', auth.uid(), auth.uid())
    on conflict (source_ref) where source_ref is not null do update
      set amount = excluded.amount, competence_date = excluded.competence_date, paid_at = excluded.paid_at,
          status = excluded.status, description = excluded.description
      where (ft.amount, ft.competence_date, ft.paid_at, ft.status, ft.description)
            is distinct from (excluded.amount, excluded.competence_date, excluded.paid_at, excluded.status, excluded.description);
  else
    update public.financial_transactions set status = 'cancelled', paid_at = null
     where source_ref = 'accident:' || new.id || ':payout' and status <> 'cancelled';
  end if;
  return null;
end;
$$;
create trigger accidents_after after insert or update on public.accidents
  for each row execute function app.after_accident_change();

create table public.accident_photos (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  accident_id   uuid not null references public.accidents(id) on delete cascade,
  storage_path  text not null unique,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  constraint accident_photos_path_chk check (storage_path like (company_id::text || '/vehicles/%/accidents/' || accident_id::text || '/%'))
);
create index accident_photos_accident_idx on public.accident_photos(accident_id);

-- ---------------------------------------------------------------------
-- Documentos ligados a manutenção, multa ou sinistro
-- ---------------------------------------------------------------------
alter table public.documents
  add column maintenance_id uuid references public.maintenance_records(id) on delete restrict,
  add column fine_id uuid references public.traffic_fines(id) on delete restrict,
  add column accident_id uuid references public.accidents(id) on delete restrict;
create index documents_maintenance_idx on public.documents(maintenance_id);
create index documents_fine_idx on public.documents(fine_id);
create index documents_accident_idx on public.documents(accident_id);

create or replace function app.default_document_retention()
returns trigger
language plpgsql
as $$
declare
  v_years smallint;
begin
  if new.retention_until is null then
    select document_retention_years into v_years from public.companies where id = new.company_id;
    if v_years is not null then
      new.retention_until := (coalesce(new.issued_at, (now() at time zone 'Europe/Madrid')::date) + make_interval(years => v_years))::date;
    end if;
  end if;
  if new.vehicle_id is not null and not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.company_id = new.company_id) then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = '23503';
  end if;
  if new.rental_id is not null and not exists (select 1 from public.rentals r where r.id = new.rental_id and r.company_id = new.company_id) then
    raise exception 'NOT_FOUND' using errcode = '23503';
  end if;
  if new.insurance_policy_id is not null and not exists (select 1 from public.insurance_policies i where i.id = new.insurance_policy_id and i.company_id = new.company_id) then
    raise exception 'NOT_FOUND' using errcode = '23503';
  end if;
  if new.maintenance_id is not null and not exists (select 1 from public.maintenance_records m where m.id = new.maintenance_id and m.company_id = new.company_id and m.vehicle_id = new.vehicle_id) then
    raise exception 'NOT_FOUND' using errcode = '23503';
  end if;
  if new.fine_id is not null and not exists (select 1 from public.traffic_fines f where f.id = new.fine_id and f.company_id = new.company_id and f.vehicle_id = new.vehicle_id) then
    raise exception 'NOT_FOUND' using errcode = '23503';
  end if;
  if new.accident_id is not null and not exists (select 1 from public.accidents a where a.id = new.accident_id and a.company_id = new.company_id and a.vehicle_id = new.vehicle_id) then
    raise exception 'NOT_FOUND' using errcode = '23503';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Auditoria, RLS e privilégios
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['maintenance_plans', 'maintenance_records', 'traffic_fines', 'accidents', 'accident_photos'] loop
    execute format('create trigger %1$s_audit before insert or update on public.%1$I
                    for each row execute function app.set_audit_fields()', t);
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I
                    for each row execute function app.log_activity()', t);
    execute format('alter table public.%1$I enable row level security', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using (company_id = app.current_company_id()) with check (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                    using (company_id = app.current_company_id() and app.is_owner())', t);
  end loop;
  -- registros com efeito financeiro: arquivar, nunca excluir
  foreach t in array array['maintenance_records', 'traffic_fines', 'accidents'] loop
    execute format('create trigger %1$s_no_hard_delete before delete on public.%1$I
                    for each row execute function app.prevent_hard_delete()', t);
  end loop;
end $$;
-- fotos de sinistro: a equipe pode remover
drop policy accident_photos_delete on public.accident_photos;
create policy accident_photos_delete on public.accident_photos for delete to authenticated
  using (company_id = app.current_company_id());

grant select, insert, update, delete on public.maintenance_plans, public.maintenance_records, public.traffic_fines,
  public.accidents, public.accident_photos to authenticated;
revoke all on public.maintenance_plans, public.maintenance_records, public.traffic_fines,
  public.accidents, public.accident_photos from anon;

-- ---------------------------------------------------------------------
-- Alertas complementares (substitui a versão da migration 0006)
-- ---------------------------------------------------------------------
create or replace function public.extra_alert_rows()
returns table (kind text, severity text, entity text, entity_id uuid, title text, due_date date)
language sql stable security invoker set search_path = ''
as $$
  with t as (select (now() at time zone 'Europe/Madrid')::date as d)
  select case when cd.expires_at < t.d then 'document_expired' else 'document_expiring' end,
         case when cd.expires_at < t.d then 'high' when cd.expires_at <= t.d + 7 then 'medium' else 'low' end,
         'customer_documents', cd.customer_id,
         cd.title || ' · ' || coalesce(case when c.customer_type = 'company' then c.company_name else c.full_name end, ''),
         cd.expires_at
  from public.customer_documents cd join public.customers c on c.id = cd.customer_id cross join t
  where cd.archived_at is null and c.archived_at is null and cd.expires_at is not null and cd.expires_at <= t.d + 30
  union all
  select 'vehicle_uninsured', 'critical', 'vehicles', v.id, v.brand || ' ' || v.model || ' · ' || v.plate, null::date
  from public.vehicles v cross join t
  where v.archived_at is null and v.status not in ('sold', 'unavailable')
    and not exists (select 1 from public.insurance_policies ip where ip.vehicle_id = v.id and ip.archived_at is null
                      and ip.start_date <= t.d and ip.end_date >= t.d)
  union all
  -- planos de manutenção vencidos / próximos (sem ordem aberta para o plano)
  select case when md.due_status = 'overdue' then 'maintenance_overdue' else 'maintenance_due' end,
         case when md.due_status = 'overdue' then 'high' else 'medium' end,
         'vehicles', md.vehicle_id, md.name || ' · ' || md.vehicle, md.next_date
  from public.maintenance_due() md
  where md.due_status <> 'ok'
    and not exists (select 1 from public.maintenance_records mr where mr.plan_id = md.plan_id
                      and mr.status in ('scheduled', 'in_progress') and mr.archived_at is null)
  union all
  -- manutenção agendada atrasada ou nos próximos 3 dias
  select 'maintenance_scheduled', case when mr.scheduled_date < t.d then 'medium' else 'info' end,
         'maintenance_records', mr.id, mr.title || ' · ' || v.plate, mr.scheduled_date
  from public.maintenance_records mr join public.vehicles v on v.id = mr.vehicle_id cross join t
  where mr.archived_at is null and mr.status = 'scheduled' and mr.scheduled_date <= t.d + 3
  union all
  -- multas: prazo para identificar o condutor
  select 'fine_identification_due', case when f.identification_deadline < t.d then 'critical' else 'high' end,
         'traffic_fines', f.id, f.authority || coalesce(' · ' || f.reference, '') || ' · ' || v.plate, f.identification_deadline
  from public.traffic_fines f join public.vehicles v on v.id = f.vehicle_id cross join t
  where f.archived_at is null and f.status = 'pending' and f.identification_deadline is not null and f.identification_deadline <= t.d + 7
  union all
  -- multas: prazo de pagamento
  select 'fine_payment_due', case when f.payment_deadline < t.d then 'high' else 'medium' end,
         'traffic_fines', f.id, f.authority || coalesce(' · ' || f.reference, '') || ' · ' || v.plate, f.payment_deadline
  from public.traffic_fines f join public.vehicles v on v.id = f.vehicle_id cross join t
  where f.archived_at is null and f.status in ('pending', 'appealed') and f.payment_deadline is not null and f.payment_deadline <= t.d + 7
  union all
  -- sinistro ainda não comunicado à seguradora
  select 'accident_unreported', 'high', 'accidents', a.id, v.brand || ' ' || v.model || ' · ' || v.plate,
         (a.occurred_at at time zone 'Europe/Madrid')::date
  from public.accidents a join public.vehicles v on v.id = a.vehicle_id
  where a.archived_at is null and a.status in ('reported', 'under_review') and a.reported_to_insurer_at is null
$$;
revoke all on function public.extra_alert_rows() from public, anon;
grant execute on function public.extra_alert_rows() to authenticated;

-- Resumo para a tela de manutenção
create or replace function public.maintenance_overview()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with t as (select (now() at time zone 'Europe/Madrid')::date as d),
  md as (select * from public.maintenance_due())
  select jsonb_build_object(
    'in_progress', (select count(*) from public.maintenance_records where archived_at is null and status = 'in_progress'),
    'scheduled',   (select count(*) from public.maintenance_records where archived_at is null and status = 'scheduled'),
    'overdue',     (select count(*) from md where due_status = 'overdue'),
    'due_soon',    (select count(*) from md where due_status = 'due_soon'),
    'cost_year',   coalesce((select sum(cost) from public.maintenance_records, t
                              where archived_at is null and status = 'completed'
                                and date_trunc('year', completed_date) = date_trunc('year', t.d)), 0)::numeric(14,2)
  );
$$;
revoke all on function public.maintenance_overview() from public, anon;
grant execute on function public.maintenance_overview() to authenticated;
