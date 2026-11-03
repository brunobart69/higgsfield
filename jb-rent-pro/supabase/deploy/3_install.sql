-- =====================================================================
-- JB RENT PRO — Instalação no Supabase: lote 3 de 3
-- Cole TODO o conteúdo no SQL Editor e clique em Run. Depois rode o lote de verificação (verify.sql).
-- Contém: 20261110000002_finance.sql, 20261111000001_calendar_notifications_portal.sql, 20261112000001_hardening.sql
-- (gerado a partir de supabase/migrations — não edite aqui)
-- =====================================================================

-- >>>>> 20261110000002_finance.sql
-- =====================================================================
-- JB RENT PRO — Migration 0008: financeiro completo e patrimônio
-- ---------------------------------------------------------------------
--   * categorias não operacionais (compra/venda de veículo, financiamento,
--     aportes e retiradas) ficam fora do resultado, mas entram no caixa
--   * lançamentos manuais com parcelas; lançamentos automáticos protegidos
--   * compra e venda do veículo lançadas automaticamente
--   * relatórios: resultado por competência ou caixa, fluxo de caixa com
--     saldo e previsão, contas a pagar/receber, rentabilidade por veículo
-- =====================================================================

-- ---------------------------------------------------------------------
-- Classificação operacional
-- ---------------------------------------------------------------------
create or replace function app.is_operational_category(c public.transaction_category)
returns boolean
language sql immutable
as $$
  select c::text not in ('vehicle_purchase', 'vehicle_sale', 'loan_received', 'owner_contribution', 'loan_repayment', 'owner_withdrawal')
$$;

alter table public.financial_transactions drop column is_operational;
alter table public.financial_transactions
  add column is_operational boolean generated always as (app.is_operational_category(category)) stored;

alter table public.financial_transactions drop constraint ft_category_type_chk;
alter table public.financial_transactions add constraint ft_category_type_chk check (
  (type = 'income' and category::text in ('rental', 'additional_fee', 'excess_mileage', 'extra_service', 'other_income',
                                          'fine_recharge', 'damage_recovery', 'vehicle_sale', 'loan_received', 'owner_contribution'))
  or (type = 'expense' and category::text not in ('rental', 'additional_fee', 'excess_mileage', 'extra_service', 'other_income',
                                                  'fine_recharge', 'damage_recovery', 'vehicle_sale', 'loan_received', 'owner_contribution'))
);

-- Parcelas / recorrência
alter table public.financial_transactions
  add column series_id uuid,
  add column installment_no smallint check (installment_no is null or installment_no >= 1),
  add column installment_count smallint check (installment_count is null or installment_count between 1 and 120),
  add column reference text check (reference is null or length(reference) <= 120);
create index ft_series_idx on public.financial_transactions(series_id) where series_id is not null;
create index ft_due_idx on public.financial_transactions(company_id, due_date) where status = 'pending' and archived_at is null;
alter table public.financial_transactions
  add constraint ft_description_len check (length(description) <= 300),
  add constraint ft_notes_len check (notes is null or length(notes) <= 2000);

-- ---------------------------------------------------------------------
-- Lançamentos automáticos: protegidos contra edição manual
-- (as rotinas de sincronização rodam dentro de gatilhos: pg_trigger_depth() > 1)
-- ---------------------------------------------------------------------
create or replace function app.guard_financial_entry()
returns trigger
language plpgsql
as $$
declare
  v_auto boolean;
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.rental_line is not null or new.source_ref is not null or new.insurance_policy_id is not null then
      raise exception 'AUTO_ENTRY_LOCKED: automatic entries are created by the system' using errcode = 'P0001';
    end if;
    -- a compra de um veículo com preço cadastrado já é lançada automaticamente
    if new.category = 'vehicle_purchase' and new.vehicle_id is not null
       and exists (select 1 from public.vehicles v where v.id = new.vehicle_id and coalesce(v.purchase_price, 0) > 0) then
      raise exception 'DUPLICATE_PURCHASE: edit the purchase price on the vehicle' using errcode = 'P0001';
    end if;
    return new;
  end if;
  v_auto := old.rental_line is not null or old.source_ref is not null or old.insurance_policy_id is not null;
  if v_auto then
    -- somente observações e comprovante podem ser completados manualmente
    if (new.type, new.category, new.description, new.amount, new.competence_date, new.due_date, new.paid_at, new.status,
        new.payment_method, new.vehicle_id, new.customer_id, new.rental_id, new.archived_at, new.vat_rate)
       is distinct from
       (old.type, old.category, old.description, old.amount, old.competence_date, old.due_date, old.paid_at, old.status,
        old.payment_method, old.vehicle_id, old.customer_id, old.rental_id, old.archived_at, old.vat_rate)
       or (new.rental_line, new.source_ref, new.insurance_policy_id) is distinct from (old.rental_line, old.source_ref, old.insurance_policy_id) then
      raise exception 'AUTO_ENTRY_LOCKED: change the origin record instead' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if (new.rental_line, new.source_ref, new.insurance_policy_id) is distinct from (old.rental_line, old.source_ref, old.insurance_policy_id) then
    raise exception 'AUTO_ENTRY_LOCKED' using errcode = 'P0001';
  end if;
  -- lançamento anulado não volta (crie outro)
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger financial_transactions_guard before insert or update on public.financial_transactions
  for each row execute function app.guard_financial_entry();

-- ---------------------------------------------------------------------
-- Compra e venda do veículo
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column sold_at date,
  add column sale_price numeric(12,2) check (sale_price is null or sale_price >= 0),
  add column sale_notes text check (sale_notes is null or length(sale_notes) <= 1000),
  add constraint vehicles_sale_chk check ((sold_at is null) = (sale_price is null));

create or replace function app.guard_vehicle_sale()
returns trigger
language plpgsql
as $$
begin
  if new.sold_at is not null and (tg_op = 'INSERT' or old.sold_at is null) then
    if exists (select 1 from public.rentals r where r.vehicle_id = new.id and r.archived_at is null
                 and r.status in ('reservation', 'confirmed', 'in_progress', 'late')) then
      raise exception 'VEHICLE_BUSY: vehicle has open rentals' using errcode = 'P0001';
    end if;
    if new.acquisition_date is not null and new.sold_at < new.acquisition_date then
      raise exception 'SALE_BEFORE_ACQUISITION' using errcode = 'P0001';
    end if;
    new.status := 'sold';
    new.fleet_exit_date := coalesce(new.fleet_exit_date, new.sold_at);
  end if;
  if new.sold_at is null and tg_op = 'UPDATE' and old.sold_at is not null then
    -- desfazer venda (correção): volta como disponível
    if new.status = 'sold' then new.status := 'available'; end if;
    if new.fleet_exit_date = old.sold_at then new.fleet_exit_date := null; end if;
  end if;
  return new;
end;
$$;
create trigger vehicles_sale_guard before insert or update on public.vehicles
  for each row execute function app.guard_vehicle_sale();

create or replace function app.sync_vehicle_finance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_buy date := coalesce(new.acquisition_date, new.fleet_entry_date, (new.created_at at time zone 'Europe/Madrid')::date);
  v_label text := new.brand || ' ' || new.model || ' · ' || new.plate;
begin
  -- compra (investimento, fora do resultado operacional)
  if coalesce(new.purchase_price, 0) > 0 then
    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, due_date, paid_at, status, vehicle_id, source_ref, created_by, updated_by)
    values (new.company_id, 'expense', 'vehicle_purchase', v_label, new.purchase_price, v_buy, v_buy, v_buy, 'paid',
            new.id, 'vehicle:' || new.id || ':purchase', auth.uid(), auth.uid())
    on conflict (source_ref) where source_ref is not null do update
      set amount = excluded.amount, competence_date = excluded.competence_date, due_date = excluded.due_date,
          paid_at = excluded.paid_at, status = excluded.status, description = excluded.description
      where (ft.amount, ft.competence_date, ft.paid_at, ft.status, ft.description)
            is distinct from (excluded.amount, excluded.competence_date, excluded.paid_at, excluded.status, excluded.description);
  else
    update public.financial_transactions set status = 'cancelled', paid_at = null
     where source_ref = 'vehicle:' || new.id || ':purchase' and status <> 'cancelled';
  end if;
  -- venda
  if new.sold_at is not null and coalesce(new.sale_price, 0) > 0 then
    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, due_date, paid_at, status, vehicle_id, source_ref, created_by, updated_by)
    values (new.company_id, 'income', 'vehicle_sale', v_label, new.sale_price, new.sold_at, new.sold_at, new.sold_at, 'paid',
            new.id, 'vehicle:' || new.id || ':sale', auth.uid(), auth.uid())
    on conflict (source_ref) where source_ref is not null do update
      set amount = excluded.amount, competence_date = excluded.competence_date, due_date = excluded.due_date,
          paid_at = excluded.paid_at, status = excluded.status, description = excluded.description
      where (ft.amount, ft.competence_date, ft.paid_at, ft.status, ft.description)
            is distinct from (excluded.amount, excluded.competence_date, excluded.paid_at, excluded.status, excluded.description);
  else
    update public.financial_transactions set status = 'cancelled', paid_at = null
     where source_ref = 'vehicle:' || new.id || ':sale' and status <> 'cancelled';
  end if;
  return null;
end;
$$;
create trigger vehicles_finance after insert or update of purchase_price, acquisition_date, fleet_entry_date, sold_at, sale_price, brand, model, plate
  on public.vehicles for each row execute function app.sync_vehicle_finance();

-- lançamento de compra para veículos já cadastrados
insert into public.financial_transactions (company_id, type, category, description, amount, competence_date, due_date, paid_at, status, vehicle_id, source_ref)
select v.company_id, 'expense', 'vehicle_purchase', v.brand || ' ' || v.model || ' · ' || v.plate, v.purchase_price,
       coalesce(v.acquisition_date, v.fleet_entry_date, v.created_at::date), coalesce(v.acquisition_date, v.fleet_entry_date, v.created_at::date),
       coalesce(v.acquisition_date, v.fleet_entry_date, v.created_at::date), 'paid', v.id, 'vehicle:' || v.id || ':purchase'
from public.vehicles v
where coalesce(v.purchase_price, 0) > 0
  and not exists (select 1 from public.financial_transactions f where f.vehicle_id = v.id and f.category = 'vehicle_purchase' and f.status <> 'cancelled');

-- ---------------------------------------------------------------------
-- Saldo inicial de caixa (para o fluxo de caixa)
-- ---------------------------------------------------------------------
alter table public.companies
  add column cash_opening_balance numeric(14,2),
  add column cash_opening_date date,
  add constraint companies_cash_opening_chk check ((cash_opening_balance is null) = (cash_opening_date is null));

-- ---------------------------------------------------------------------
-- Movimentos de caixa (base única para relatórios em regime de caixa)
--   * aluguéis: pagamentos e estornos efetivos (rental_payments)
--   * demais lançamentos pagos, pela data de pagamento
--   * cauções ficam separadas (não são receita)
-- ---------------------------------------------------------------------
create or replace function app.cash_movements(p_from date, p_to date)
returns table (day date, type public.transaction_type, category public.transaction_category, amount numeric, operational boolean)
language sql stable security invoker set search_path = ''
as $$
  select rp.paid_at, case when rp.kind = 'payment' then 'income'::public.transaction_type else 'expense'::public.transaction_type end,
         'rental'::public.transaction_category, rp.amount, true
  from public.rental_payments rp
  where rp.voided_at is null and rp.paid_at between p_from and p_to
  union all
  select f.paid_at, f.type, f.category, f.amount, f.is_operational
  from public.financial_transactions f
  where f.archived_at is null and f.status = 'paid' and f.rental_line is null and f.paid_at between p_from and p_to
$$;

-- ---------------------------------------------------------------------
-- Resultado do período: competência (padrão) ou caixa
-- ---------------------------------------------------------------------
create or replace function public.finance_report(p_from date, p_to date, p_basis text default 'accrual')
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_basis not in ('accrual', 'cash') then
    raise exception 'INVALID_BASIS' using errcode = '22023';
  end if;
  with lines as (
    select f.type, f.category, f.amount, f.is_operational as op
    from public.financial_transactions f
    where p_basis = 'accrual' and f.archived_at is null and f.status <> 'cancelled' and f.competence_date between p_from and p_to
    union all
    -- caixa: entradas efetivas; estorno de aluguel reduz a receita (não é despesa)
    select case when m.category = 'rental' then 'income'::public.transaction_type else m.type end, m.category,
           case when m.category = 'rental' and m.type = 'expense' then -m.amount else m.amount end, m.operational
    from app.cash_movements(p_from, p_to) m
    where p_basis = 'cash'
  ),
  cat as (
    select type, category, op, sum(amount)::numeric(14,2) as total from lines group by type, category, op
  )
  select jsonb_build_object(
    'income',   coalesce((select sum(total) from cat where op and type = 'income'), 0)::numeric(14,2),
    'expenses', coalesce((select sum(total) from cat where op and type = 'expense'), 0)::numeric(14,2),
    'result',   (coalesce((select sum(total) from cat where op and type = 'income'), 0)
                 - coalesce((select sum(total) from cat where op and type = 'expense'), 0))::numeric(14,2),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'category', category, 'total', total) order by type desc, total desc)
                             from cat where op and total <> 0), '[]'::jsonb),
    'non_operational', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'category', category, 'total', total) order by type desc, total desc)
                                 from cat where not op and total <> 0), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function public.finance_report(date, date, text) from public, anon;
grant execute on function public.finance_report(date, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- Fluxo de caixa mensal: realizado, previsto (a vencer), cauções e saldo
-- ---------------------------------------------------------------------
create or replace function public.cash_flow(p_from date, p_to date)
returns table (month date, inflow numeric, outflow numeric, net numeric, balance numeric,
               projected_in numeric, projected_out numeric, deposits_in numeric, deposits_out numeric)
language sql stable security invoker set search_path = ''
as $$
  with co as (
    select cash_opening_balance as ob, cash_opening_date as od from public.companies where id = app.current_company_id()
  ),
  base as (select coalesce((select od from co), date '2000-01-01') as start, coalesce((select ob from co), 0) as ob),
  months as (
    select gs::date as m from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs
  ),
  mv as (
    select date_trunc('month', day)::date as m,
           sum(amount) filter (where type = 'income') as i,
           sum(amount) filter (where type = 'expense') as o
    from app.cash_movements((select start from base), p_to)
    group by 1
  ),
  proj as (
    select date_trunc('month', coalesce(f.due_date, f.competence_date))::date as m,
           sum(f.amount) filter (where f.type = 'income' and f.rental_line is null) as pi,
           sum(f.amount) filter (where f.type = 'expense') as po
    from public.financial_transactions f
    where f.archived_at is null and f.status = 'pending'
      and coalesce(f.due_date, f.competence_date) between p_from and p_to
    group by 1
  ),
  -- aluguéis com saldo em aberto: previsão pela data de retirada
  rproj as (
    select date_trunc('month', greatest((r.pickup_at at time zone 'Europe/Madrid')::date, (now() at time zone 'Europe/Madrid')::date))::date as m,
           sum(greatest(r.total_amount - coalesce(p.paid, 0), 0)) as pi
    from public.rentals r
    left join (select rental_id, sum(case when kind = 'payment' then amount else -amount end) as paid
                 from public.rental_payments where voided_at is null group by rental_id) p on p.rental_id = r.id
    where r.archived_at is null and r.status in ('confirmed', 'in_progress', 'late', 'completed')
    group by 1
  ),
  dep as (
    select m, sum(i) as i, sum(o) as o from (
      select date_trunc('month', received_at)::date as m, amount_received as i, 0::numeric as o from public.deposits where received_at is not null
      union all
      select date_trunc('month', returned_at)::date, 0, amount_returned from public.deposits where returned_at is not null
    ) x group by m
  )
  select mo.m,
         coalesce(mv.i, 0)::numeric(14,2), coalesce(mv.o, 0)::numeric(14,2), (coalesce(mv.i, 0) - coalesce(mv.o, 0))::numeric(14,2),
         ((select ob from base) + coalesce((select sum(coalesce(x.i, 0) - coalesce(x.o, 0)) from mv x where x.m <= mo.m), 0))::numeric(14,2),
         (coalesce(proj.pi, 0) + coalesce(rproj.pi, 0))::numeric(14,2), coalesce(proj.po, 0)::numeric(14,2),
         coalesce(dep.i, 0)::numeric(14,2), coalesce(dep.o, 0)::numeric(14,2)
  from months mo
  left join mv on mv.m = mo.m
  left join proj on proj.m = mo.m
  left join rproj on rproj.m = mo.m
  left join dep on dep.m = mo.m
  order by mo.m
$$;
revoke all on function public.cash_flow(date, date) from public, anon;
grant execute on function public.cash_flow(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Contas a receber e a pagar
--   receber: saldo de contratos + demais receitas pendentes
--   pagar: despesas pendentes
-- ---------------------------------------------------------------------
create or replace function public.open_items(p_type public.transaction_type)
returns table (kind text, id uuid, description text, category public.transaction_category, amount numeric,
               due_date date, vehicle_id uuid, plate text, customer_id uuid, customer text, rental_id uuid,
               installment_no smallint, installment_count smallint)
language sql stable security invoker set search_path = ''
as $$
  select 'rental', r.id, r.contract_number, 'rental'::public.transaction_category,
         (r.total_amount - coalesce(p.paid, 0))::numeric(14,2),
         (r.pickup_at at time zone 'Europe/Madrid')::date, r.vehicle_id, v.plate, r.customer_id,
         case when c.customer_type = 'company' then c.company_name else c.full_name end, r.id, null::smallint, null::smallint
  from public.rentals r
  join public.vehicles v on v.id = r.vehicle_id
  join public.customers c on c.id = r.customer_id
  left join (select rental_id, sum(case when kind = 'payment' then amount else -amount end) as paid
               from public.rental_payments where voided_at is null group by rental_id) p on p.rental_id = r.id
  where p_type = 'income' and r.archived_at is null and r.status in ('confirmed', 'in_progress', 'late', 'completed')
    and r.total_amount - coalesce(p.paid, 0) > 0
  union all
  select 'entry', f.id, f.description, f.category, f.amount, coalesce(f.due_date, f.competence_date),
         f.vehicle_id, v.plate, f.customer_id, case when c.customer_type = 'company' then c.company_name else c.full_name end,
         f.rental_id, f.installment_no, f.installment_count
  from public.financial_transactions f
  left join public.vehicles v on v.id = f.vehicle_id
  left join public.customers c on c.id = f.customer_id
  where f.type = p_type and f.archived_at is null and f.status = 'pending' and f.rental_line is null
  order by 6 nulls last
$$;
revoke all on function public.open_items(public.transaction_type) from public, anon;
grant execute on function public.open_items(public.transaction_type) to authenticated;

-- ---------------------------------------------------------------------
-- Rentabilidade por veículo (desde a entrada na frota)
-- ---------------------------------------------------------------------
create or replace function public.fleet_roi()
returns table (vehicle_id uuid, label text, plate text, status public.vehicle_status, acquisition_date date,
               purchase_price numeric, current_value numeric, sold_at date, sale_price numeric,
               revenue numeric, expenses numeric, profit numeric, months_in_fleet numeric, rented_days integer,
               available_days integer)
language sql stable security invoker set search_path = ''
as $$
  with t as (select (now() at time zone 'Europe/Madrid')::date as d),
  ft as (
    select vehicle_id,
           sum(amount) filter (where type = 'income' and is_operational) as inc,
           sum(amount) filter (where type = 'expense' and is_operational) as exp
    from public.financial_transactions
    where archived_at is null and status <> 'cancelled' and vehicle_id is not null
    group by vehicle_id
  ),
  rd as (
    select r.vehicle_id,
           sum(greatest(0, ((coalesce(r.actual_return_at, least(r.return_at, now())) at time zone 'Europe/Madrid')::date
                           - (r.pickup_at at time zone 'Europe/Madrid')::date)))::integer as days
    from public.rentals r
    where r.archived_at is null and r.status in ('in_progress', 'late', 'completed') and r.pickup_at <= now()
    group by r.vehicle_id
  )
  select v.id, v.brand || ' ' || v.model, v.plate, v.status,
         coalesce(v.acquisition_date, v.fleet_entry_date),
         v.purchase_price,
         coalesce(v.sale_price,
                  (select vv.value from public.vehicle_valuations vv where vv.vehicle_id = v.id order by vv.valuation_date desc limit 1),
                  v.market_value, v.purchase_price),
         v.sold_at, v.sale_price,
         coalesce(ft.inc, 0)::numeric(14,2), coalesce(ft.exp, 0)::numeric(14,2), (coalesce(ft.inc, 0) - coalesce(ft.exp, 0))::numeric(14,2),
         round(greatest(1, (coalesce(v.sold_at, v.fleet_exit_date, t.d) - coalesce(v.fleet_entry_date, v.acquisition_date, v.created_at::date)) + 1) / 30.4375, 1),
         coalesce(rd.days, 0),
         greatest(1, (coalesce(v.sold_at, v.fleet_exit_date, t.d) - coalesce(v.fleet_entry_date, v.acquisition_date, v.created_at::date)) + 1)::integer
  from public.vehicles v cross join t
  left join ft on ft.vehicle_id = v.id
  left join rd on rd.vehicle_id = v.id
  where v.archived_at is null
  order by v.status = 'sold', (coalesce(ft.inc, 0) - coalesce(ft.exp, 0)) desc
$$;
revoke all on function public.fleet_roi() from public, anon;
grant execute on function public.fleet_roi() to authenticated;

-- >>>>> 20261111000001_calendar_notifications_portal.sql
-- =====================================================================
-- JB RENT PRO — Migration 0009: calendário, notificações e área do cliente
-- ---------------------------------------------------------------------
--   * calendar_events: contratos, manutenções, vencimentos de seguro/ITV e
--     prazos de multas num único feed; available_vehicles: busca por período
--   * notificações persistentes por empresa, geradas a partir dos alertas,
--     com leitura por usuário e resolução automática
--   * área do cliente: conta vinculada a UM cliente (sem perfil da equipe),
--     acesso somente por funções que filtram pelo próprio cliente
--   * solicitações de reserva feitas pelo cliente
-- =====================================================================

-- ---------------------------------------------------------------------
-- Calendário
-- ---------------------------------------------------------------------
create or replace function public.calendar_events(p_from date, p_to date)
returns table (kind text, id uuid, vehicle_id uuid, plate text, title text, subtitle text,
               starts_at timestamptz, ends_at timestamptz, all_day boolean, status text)
language sql stable security invoker set search_path = ''
as $$
  with b as (
    select (p_from::timestamp at time zone 'Europe/Madrid') as f,
           ((p_to + 1)::timestamp at time zone 'Europe/Madrid') as t
  )
  select 'rental', r.id, r.vehicle_id, v.plate, r.contract_number,
         coalesce(case when c.customer_type = 'company' then c.company_name else c.full_name end, ''),
         r.pickup_at, coalesce(r.actual_return_at, r.return_at), false, r.status::text
  from public.rentals r join public.vehicles v on v.id = r.vehicle_id join public.customers c on c.id = r.customer_id cross join b
  where r.archived_at is null and r.status <> 'cancelled'
    and r.pickup_at < b.t and coalesce(r.actual_return_at, r.return_at) >= b.f
  union all
  select 'maintenance', m.id, m.vehicle_id, v.plate, m.title, coalesce(m.workshop, ''),
         (coalesce(m.started_at, m.scheduled_date)::timestamp at time zone 'Europe/Madrid'),
         ((coalesce(m.completed_date, greatest(coalesce(m.started_at, m.scheduled_date), case when m.status = 'in_progress' then (now() at time zone 'Europe/Madrid')::date end)) + 1)::timestamp at time zone 'Europe/Madrid'),
         true, m.status::text
  from public.maintenance_records m join public.vehicles v on v.id = m.vehicle_id
  where m.archived_at is null and m.status <> 'cancelled' and coalesce(m.started_at, m.scheduled_date) is not null
    and coalesce(m.started_at, m.scheduled_date) <= p_to
    and coalesce(m.completed_date, greatest(coalesce(m.started_at, m.scheduled_date), case when m.status = 'in_progress' then (now() at time zone 'Europe/Madrid')::date end)) >= p_from
  union all
  select 'insurance_end', ip.id, ip.vehicle_id, v.plate, ip.insurer || ' · ' || ip.policy_number, '',
         (ip.end_date::timestamp at time zone 'Europe/Madrid'), ((ip.end_date + 1)::timestamp at time zone 'Europe/Madrid'), true,
         case when exists (select 1 from public.insurance_policies n where n.renewed_from_id = ip.id and n.archived_at is null) then 'renewed' else 'open' end
  from public.insurance_policies ip join public.vehicles v on v.id = ip.vehicle_id
  where ip.archived_at is null and ip.end_date between p_from and p_to
  union all
  select 'itv', v.id, v.id, v.plate, v.brand || ' ' || v.model, '',
         (v.itv_due_date::timestamp at time zone 'Europe/Madrid'), ((v.itv_due_date + 1)::timestamp at time zone 'Europe/Madrid'), true, 'open'
  from public.vehicles v
  where v.archived_at is null and v.status <> 'sold' and v.itv_due_date between p_from and p_to
  union all
  select 'fine_deadline', f.id, f.vehicle_id, v.plate, f.authority || coalesce(' · ' || f.reference, ''),
         case when f.status = 'pending' and f.identification_deadline between p_from and p_to then 'identification' else 'payment' end,
         (d::timestamp at time zone 'Europe/Madrid'), ((d + 1)::timestamp at time zone 'Europe/Madrid'), true, f.status::text
  from public.traffic_fines f join public.vehicles v on v.id = f.vehicle_id
  cross join lateral (select case when f.status = 'pending' and f.identification_deadline between p_from and p_to then f.identification_deadline
                                  else f.payment_deadline end as d) x
  where f.archived_at is null and f.status in ('pending', 'appealed') and x.d between p_from and p_to
  order by 7
$$;
revoke all on function public.calendar_events(date, date) from public, anon;
grant execute on function public.calendar_events(date, date) to authenticated;

-- Veículos para um período: livres, ocupados ou com ressalvas (manutenção agendada, sem seguro)
create or replace function public.available_vehicles(p_from timestamptz, p_to timestamptz)
returns table (vehicle_id uuid, label text, plate text, category text, daily_price numeric, status public.vehicle_status,
               available boolean, conflict_contract text, maintenance_conflict boolean, insured boolean)
language sql stable security invoker set search_path = ''
as $$
  select v.id, v.brand || ' ' || v.model || coalesce(' ' || v.version, ''), v.plate, v.category, v.daily_price, v.status,
         v.status not in ('maintenance', 'unavailable', 'sold') and c.contract_number is null,
         c.contract_number,
         exists (select 1 from public.maintenance_records m where m.vehicle_id = v.id and m.archived_at is null
                   and m.status in ('scheduled', 'in_progress') and m.blocks_vehicle
                   and coalesce(m.started_at, m.scheduled_date) <= (p_to at time zone 'Europe/Madrid')::date
                   and (m.status = 'in_progress' or m.scheduled_date >= (p_from at time zone 'Europe/Madrid')::date)),
         exists (select 1 from public.insurance_policies ip where ip.vehicle_id = v.id and ip.archived_at is null
                   and ip.start_date <= (p_from at time zone 'Europe/Madrid')::date and ip.end_date >= (p_to at time zone 'Europe/Madrid')::date)
           or exists (select 1 from public.insurance_policies a join public.insurance_policies n on n.renewed_from_id = a.id and n.archived_at is null
                        where a.vehicle_id = v.id and a.archived_at is null
                          and a.start_date <= (p_from at time zone 'Europe/Madrid')::date and n.end_date >= (p_to at time zone 'Europe/Madrid')::date)
  from public.vehicles v
  left join lateral (
    select r.contract_number from public.rentals r
    where r.vehicle_id = v.id and r.archived_at is null and r.status in ('reservation', 'confirmed', 'in_progress', 'late')
      -- em andamento ocupa desde a retirada real até a devolução (ou agora, se atrasado)
      and tstzrange(least(r.pickup_at, coalesce(r.picked_up_at, r.pickup_at)),
                    case when r.status in ('in_progress', 'late') then greatest(r.return_at, now()) else r.return_at end, '[)')
          && tstzrange(p_from, p_to, '[)')
    order by r.pickup_at limit 1
  ) c on true
  where v.archived_at is null and v.status <> 'sold' and p_to > p_from
  order by 7 desc, v.daily_price nulls last, v.plate
$$;
revoke all on function public.available_vehicles(timestamptz, timestamptz) from public, anon;
grant execute on function public.available_vehicles(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default app.current_company_id() references public.companies(id) on delete cascade,
  source       text not null default 'alert' check (source in ('alert', 'event')),
  kind         text not null check (length(kind) <= 60),
  severity     text not null default 'info' check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  title        text not null check (length(title) <= 300),
  entity       text check (entity is null or length(entity) <= 60),
  entity_id    uuid,
  due_date     date,
  dedupe_key   text not null check (length(dedupe_key) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (company_id, dedupe_key)
);
create index notifications_open_idx on public.notifications(company_id, created_at desc) where resolved_at is null;

create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table public.notification_state (
  company_id   uuid primary key default app.current_company_id() references public.companies(id) on delete cascade,
  refreshed_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.notification_state enable row level security;
create policy notifications_select on public.notifications for select to authenticated using (company_id = app.current_company_id());
create policy notifications_insert on public.notifications for insert to authenticated with check (company_id = app.current_company_id());
create policy notifications_update on public.notifications for update to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
create policy notification_reads_select on public.notification_reads for select to authenticated using (user_id = auth.uid());
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.notifications n where n.id = notification_id and n.company_id = app.current_company_id()));
create policy notification_reads_delete on public.notification_reads for delete to authenticated using (user_id = auth.uid());
create policy notification_state_all on public.notification_state for all to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
grant select, insert, update on public.notifications to authenticated;
grant select, insert, delete on public.notification_reads to authenticated;
grant select, insert, update on public.notification_state to authenticated;
revoke all on public.notifications, public.notification_reads, public.notification_state from anon;

/**
 * Sincroniza as notificações com os alertas atuais (no máximo a cada p_min_interval).
 * Alertas novos viram notificações; os que deixaram de existir ficam resolvidos.
 */
create or replace function public.refresh_notifications(p_min_interval interval default interval '5 minutes')
returns integer
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_company uuid := app.current_company_id();
  v_last timestamptz;
  v_new integer;
begin
  if v_company is null then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  select refreshed_at into v_last from public.notification_state where company_id = v_company for update;
  if v_last is not null and v_last > now() - p_min_interval then
    return 0;
  end if;
  insert into public.notification_state (company_id, refreshed_at) values (v_company, now())
  on conflict (company_id) do update set refreshed_at = excluded.refreshed_at;

  create temporary table if not exists pg_temp.cur_alerts (kind text, severity text, entity text, entity_id uuid, title text, due_date date, k text) on commit drop;
  delete from pg_temp.cur_alerts;
  insert into pg_temp.cur_alerts
  select a.kind, a.severity, a.entity, a.entity_id, left(a.title, 300), a.due_date,
         left(a.kind || ':' || coalesce(a.entity_id::text, '') || ':' || coalesce(a.due_date::text, ''), 200)
  from (select * from public.dashboard_alerts(100) union all select * from public.extra_alert_rows()) a;

  with ins as (
    insert into public.notifications (company_id, source, kind, severity, title, entity, entity_id, due_date, dedupe_key)
    select distinct on (k) v_company, 'alert', kind, severity, title, entity, entity_id, due_date, k from pg_temp.cur_alerts
    on conflict (company_id, dedupe_key) do update
      set severity = excluded.severity, title = excluded.title, resolved_at = null, updated_at = now()
      where public.notifications.resolved_at is not null
         or (public.notifications.severity, public.notifications.title) is distinct from (excluded.severity, excluded.title)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into v_new from ins;

  update public.notifications n set resolved_at = now(), updated_at = now()
   where n.company_id = v_company and n.source = 'alert' and n.resolved_at is null
     and not exists (select 1 from pg_temp.cur_alerts c where c.k = n.dedupe_key);
  return v_new;
end;
$$;
revoke all on function public.refresh_notifications(interval) from public, anon;
grant execute on function public.refresh_notifications(interval) to authenticated;

-- Não lidas (abertas) do usuário atual
create or replace function public.unread_notifications()
returns integer
language sql stable security invoker set search_path = ''
as $$
  select count(*)::integer from public.notifications n
  where n.resolved_at is null
    and not exists (select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())
$$;
revoke all on function public.unread_notifications() from public, anon;
grant execute on function public.unread_notifications() to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language sql volatile security invoker set search_path = ''
as $$
  with ins as (
    insert into public.notification_reads (notification_id, user_id)
    select n.id, auth.uid() from public.notifications n
    where (p_ids is null and n.resolved_at is null) or n.id = any (p_ids)
    on conflict do nothing
    returning 1
  )
  select count(*)::integer from ins
$$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Área do cliente
-- ---------------------------------------------------------------------
create table public.customer_portal_accounts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  company_id    uuid not null default app.current_company_id() references public.companies(id) on delete cascade,
  customer_id   uuid not null unique references public.customers(id) on delete cascade,
  email         text not null,
  invited_at    timestamptz not null default now(),
  invited_by    uuid references auth.users(id) on delete set null,
  last_seen_at  timestamptz,
  disabled_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function app.guard_portal_account()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- quem é da equipe não pode ser cliente do portal (e vice-versa)
  if exists (select 1 from public.profiles p where p.id = new.user_id) then
    raise exception 'PORTAL_STAFF_CONFLICT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id
                   and c.archived_at is null and c.anonymized_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and (new.user_id, new.customer_id, new.company_id) is distinct from (old.user_id, old.customer_id, old.company_id) then
    raise exception 'PORTAL_LOCKED' using errcode = 'P0001';
  end if;
  new.email := lower(trim(new.email));
  return new;
end;
$$;
create trigger customer_portal_accounts_guard before insert or update on public.customer_portal_accounts
  for each row execute function app.guard_portal_account();

-- impede que uma conta do portal vire perfil da equipe
create or replace function app.guard_profile_not_portal()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.customer_portal_accounts a where a.user_id = new.id) then
    raise exception 'PORTAL_STAFF_CONFLICT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger profiles_not_portal before insert on public.profiles
  for each row execute function app.guard_profile_not_portal();

alter table public.customer_portal_accounts enable row level security;
create policy portal_accounts_select on public.customer_portal_accounts for select to authenticated using (company_id = app.current_company_id());
create policy portal_accounts_insert on public.customer_portal_accounts for insert to authenticated with check (company_id = app.current_company_id());
create policy portal_accounts_update on public.customer_portal_accounts for update to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
grant select, insert, update on public.customer_portal_accounts to authenticated;
revoke all on public.customer_portal_accounts from anon;
-- ativação/desativação registradas pela aplicação (log_event 'portal.invited' / 'portal.disabled')

-- anonimização encerra o acesso
create or replace function app.after_customer_anonymized()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.anonymized_at is not null and old.anonymized_at is null then
    update public.customer_portal_accounts set disabled_at = coalesce(disabled_at, now()) where customer_id = new.id;
  end if;
  return null;
end;
$$;
create trigger customers_portal_anonymized after update of anonymized_at on public.customers
  for each row execute function app.after_customer_anonymized();

-- Cliente do portal autenticado (null para equipe/anônimo/desativado)
create or replace function app.portal_account()
returns public.customer_portal_accounts
language sql stable security definer set search_path = ''
as $$
  select a.* from public.customer_portal_accounts a
  join public.customers c on c.id = a.customer_id
  where a.user_id = auth.uid() and a.disabled_at is null and c.archived_at is null and c.anonymized_at is null
$$;

create or replace function app.require_portal()
returns public.customer_portal_accounts
language plpgsql stable security definer set search_path = ''
as $$
declare
  a public.customer_portal_accounts;
begin
  a := app.portal_account();
  if a.user_id is null then
    raise exception 'PORTAL_FORBIDDEN' using errcode = '42501';
  end if;
  return a;
end;
$$;

create or replace function public.portal_me()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.customer_portal_accounts := app.require_portal();
  v jsonb;
begin
  update public.customer_portal_accounts set last_seen_at = now() where user_id = a.user_id
    and (last_seen_at is null or last_seen_at < now() - interval '10 minutes');
  select jsonb_build_object(
    'customer_id', c.id,
    'name', case when c.customer_type = 'company' then c.company_name else c.full_name end,
    'customer_type', c.customer_type,
    'email', c.email, 'phone', c.phone,
    'driving_licence_expiry', c.driving_licence_expiry,
    'company', jsonb_build_object('name', co.name, 'legal_name', co.legal_name, 'phone', co.phone, 'email', co.email,
                                  'address', co.address, 'city', co.city, 'logo', co.logo_path is not null, 'default_locale', co.default_locale)
  ) into v
  from public.customers c join public.companies co on co.id = c.company_id
  where c.id = a.customer_id;
  return v;
end;
$$;

create or replace function public.portal_rentals()
returns table (id uuid, contract_number text, status public.rental_status, pickup_at timestamptz, return_at timestamptz,
               actual_return_at timestamptz, vehicle text, plate text, pickup_location text, return_location text,
               total_amount numeric, paid numeric, balance numeric, deposit_amount numeric, deposit_status text,
               deposit_balance numeric, signature_status text, contract_locale text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.contract_number, r.status, r.pickup_at, r.return_at, r.actual_return_at,
         v.brand || ' ' || v.model, v.plate, r.pickup_location, r.return_location,
         r.total_amount, coalesce(p.paid, 0)::numeric(14,2), greatest(r.total_amount - coalesce(p.paid, 0), 0)::numeric(14,2),
         r.deposit_amount, d.status, d.balance, r.signature_status::text, r.contract_locale::text
  from public.rentals r
  join public.vehicles v on v.id = r.vehicle_id
  left join public.deposits d on d.rental_id = r.id
  left join (select rental_id, sum(case when kind = 'payment' then amount else -amount end) as paid
               from public.rental_payments where voided_at is null group by rental_id) p on p.rental_id = r.id
  where r.customer_id = (app.require_portal()).customer_id and r.archived_at is null
  order by r.pickup_at desc
$$;

create or replace function public.portal_rental_payments(p_rental uuid)
returns table (kind text, amount numeric, paid_at date, method text)
language sql stable security definer set search_path = ''
as $$
  select rp.kind::text, rp.amount, rp.paid_at, rp.method::text
  from public.rental_payments rp join public.rentals r on r.id = rp.rental_id
  where rp.rental_id = p_rental and rp.voided_at is null
    and r.customer_id = (app.require_portal()).customer_id and r.archived_at is null
  order by rp.paid_at
$$;

create or replace function public.portal_documents()
returns table (kind text, id uuid, title text, category text, expires_at date, created_at timestamptz, contract_number text)
language sql stable security definer set search_path = ''
as $$
  select 'customer-doc', cd.id, cd.title, cd.doc_type::text, cd.expires_at, cd.created_at, null::text
  from public.customer_documents cd
  where cd.customer_id = (app.require_portal()).customer_id and cd.archived_at is null
  union all
  select 'rental-doc', d.id, d.title, d.category::text, d.expires_at, d.created_at, r.contract_number
  from public.documents d join public.rentals r on r.id = d.rental_id
  where r.customer_id = (app.require_portal()).customer_id and d.archived_at is null and d.category in ('contract', 'receipt', 'invoice')
  order by 6 desc
$$;

create or replace function public.portal_fines()
returns table (kind text, id uuid, occurred_at timestamptz, description text, plate text, contract_number text,
               status text, amount numeric, charged numeric, charged_paid_at date)
language sql stable security definer set search_path = ''
as $$
  select 'fine', f.id, f.infraction_at, f.infraction || ' · ' || f.authority, v.plate, r.contract_number,
         f.status::text, f.amount, f.recharge_amount, f.recharge_paid_at
  from public.traffic_fines f join public.vehicles v on v.id = f.vehicle_id left join public.rentals r on r.id = f.rental_id
  where f.customer_id = (app.require_portal()).customer_id and f.archived_at is null and f.status <> 'cancelled'
  union all
  select 'accident', a.id, a.occurred_at, a.description, v.plate, r.contract_number,
         a.status::text, null, a.deductible_amount, a.deductible_paid_at
  from public.accidents a join public.vehicles v on v.id = a.vehicle_id left join public.rentals r on r.id = a.rental_id
  where a.customer_id = (app.require_portal()).customer_id and a.archived_at is null and a.status <> 'rejected'
  order by 3 desc
$$;

-- Caminho de arquivo do próprio cliente (para link temporário gerado pelo servidor); aberturas ficam registradas
create or replace function public.portal_file_path(p_kind text, p_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.customer_portal_accounts := app.require_portal();
  v_path text;
  v_entity text;
begin
  if p_kind = 'customer-doc' then
    select storage_path into v_path from public.customer_documents where id = p_id and customer_id = a.customer_id and archived_at is null;
    v_entity := 'customer_documents';
  elsif p_kind = 'rental-doc' then
    select d.storage_path into v_path from public.documents d join public.rentals r on r.id = d.rental_id
     where d.id = p_id and r.customer_id = a.customer_id and d.archived_at is null and d.category in ('contract', 'receipt', 'invoice');
    v_entity := 'documents';
  end if;
  if v_path is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, changes)
  values (a.company_id, a.user_id, 'portal.file_downloaded', v_entity, p_id::text, jsonb_build_object('customer_id', a.customer_id));
  return v_path;
end;
$$;

-- O contrato pertence ao cliente do portal?
create or replace function public.portal_owns_rental(p_rental uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rentals r where r.id = p_rental and r.archived_at is null
                   and r.status <> 'cancelled' and r.customer_id = (app.portal_account()).customer_id)
$$;

do $$
declare f text;
begin
  foreach f in array array['portal_me()', 'portal_rentals()', 'portal_rental_payments(uuid)', 'portal_documents()', 'portal_fines()',
                           'portal_file_path(text, uuid)', 'portal_owns_rental(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Localiza um usuário de autenticação pelo e-mail (uso exclusivo do servidor ao ativar o portal)
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Solicitações de reserva pelo portal
-- ---------------------------------------------------------------------
create table public.rental_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  customer_id   uuid not null references public.customers(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  pickup_at     timestamptz not null,
  return_at     timestamptz not null,
  vehicle_preference text check (vehicle_preference is null or length(vehicle_preference) <= 160),
  notes         text check (notes is null or length(notes) <= 1000),
  status        text not null default 'new' check (status in ('new', 'contacted', 'converted', 'declined')),
  rental_id     uuid references public.rentals(id) on delete set null,
  handled_by    uuid references auth.users(id) on delete set null,
  handled_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint rental_requests_dates_chk check (return_at > pickup_at)
);
create index rental_requests_company_idx on public.rental_requests(company_id, status, created_at desc);
alter table public.rental_requests enable row level security;
create policy rental_requests_select on public.rental_requests for select to authenticated using (company_id = app.current_company_id());
create policy rental_requests_update on public.rental_requests for update to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
grant select, update on public.rental_requests to authenticated;
revoke all on public.rental_requests from anon;
create trigger rental_requests_log after insert or update on public.rental_requests
  for each row execute function app.log_activity();

create or replace function app.guard_rental_request()
returns trigger
language plpgsql
as $$
begin
  if (new.company_id, new.customer_id, new.pickup_at, new.return_at, new.user_id) is distinct from
     (old.company_id, old.customer_id, old.pickup_at, old.return_at, old.user_id) then
    raise exception 'REQUEST_LOCKED' using errcode = 'P0001';
  end if;
  if new.status <> old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  if new.rental_id is not null and not exists (select 1 from public.rentals r where r.id = new.rental_id and r.customer_id = new.customer_id) then
    raise exception 'LINK_MISMATCH' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger rental_requests_guard before update on public.rental_requests
  for each row execute function app.guard_rental_request();

create or replace function public.portal_request_rental(p_pickup timestamptz, p_return timestamptz, p_preference text, p_notes text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.customer_portal_accounts := app.require_portal();
  v_id uuid;
  v_name text;
begin
  if p_pickup < now() - interval '1 hour' or p_return <= p_pickup or p_return > now() + interval '2 years' then
    raise exception 'INVALID_PERIOD' using errcode = 'P0001';
  end if;
  if (select count(*) from public.rental_requests where customer_id = a.customer_id and status in ('new', 'contacted')) >= 5 then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  insert into public.rental_requests (company_id, customer_id, user_id, pickup_at, return_at, vehicle_preference, notes)
  values (a.company_id, a.customer_id, a.user_id, p_pickup, p_return, nullif(left(trim(p_preference), 160), ''), nullif(left(trim(p_notes), 1000), ''))
  returning id into v_id;
  select case when customer_type = 'company' then company_name else full_name end into v_name from public.customers where id = a.customer_id;
  insert into public.notifications (company_id, source, kind, severity, title, entity, entity_id, due_date, dedupe_key)
  values (a.company_id, 'event', 'rental_request', 'high', coalesce(v_name, '') || ' · ' ||
            to_char(p_pickup at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ' → ' || to_char(p_return at time zone 'Europe/Madrid', 'DD/MM/YYYY'),
          'rental_requests', v_id, (p_pickup at time zone 'Europe/Madrid')::date, 'request:' || v_id);
  return v_id;
end;
$$;
revoke all on function public.portal_request_rental(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.portal_request_rental(timestamptz, timestamptz, text, text) to authenticated;

create or replace function public.portal_requests()
returns table (id uuid, pickup_at timestamptz, return_at timestamptz, vehicle_preference text, notes text, status text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select id, pickup_at, return_at, vehicle_preference, notes, status, created_at from public.rental_requests
  where customer_id = (app.require_portal()).customer_id order by created_at desc limit 20
$$;
revoke all on function public.portal_requests() from public, anon;
grant execute on function public.portal_requests() to authenticated;

-- solicitação tratada → notificação resolvida
create or replace function app.after_request_handled()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status in ('converted', 'declined') and old.status not in ('converted', 'declined') then
    update public.notifications set resolved_at = now(), updated_at = now()
     where company_id = new.company_id and dedupe_key = 'request:' || new.id and resolved_at is null;
  end if;
  return null;
end;
$$;
create trigger rental_requests_after after update on public.rental_requests
  for each row execute function app.after_request_handled();

-- eventos do portal no registro de atividades
create or replace function public.log_event(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_action not in ('user.invite', 'user.password_link', 'user.sessions_revoked', 'company.logo_updated',
                      'customer.anonymized', 'file.downloaded', 'report.generated', 'portal.invited', 'portal.disabled') then
    raise exception 'INVALID_EVENT' using errcode = '22023';
  end if;
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, changes)
  values (app.current_company_id(), auth.uid(), p_action, left(p_entity, 60), left(p_entity_id, 100), p_details);
end;
$$;

-- Arquivos do próprio cliente no Storage (links temporários gerados com a sessão do cliente)
create policy documents_bucket_portal_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (app.portal_account()).customer_id is not null
    and (
      exists (select 1 from public.customer_documents cd
               where cd.storage_path = name and cd.archived_at is null and cd.customer_id = (app.portal_account()).customer_id)
      or exists (select 1 from public.documents d join public.rentals r on r.id = d.rental_id
                  where d.storage_path = name and d.archived_at is null and d.category in ('contract', 'receipt', 'invoice')
                    and r.customer_id = (app.portal_account()).customer_id)
    )
  );

-- >>>>> 20261112000001_hardening.sql
-- =====================================================================
-- JB RENT PRO — Migration 0010: endurecimento (revisão de segurança)
-- ---------------------------------------------------------------------
--   * documentos da empresa: exclusão definitiva somente pela função
--     purge_document (administrador principal + prazo de retenção vencido)
-- =====================================================================
create trigger documents_no_hard_delete before delete on public.documents
  for each row execute function app.prevent_hard_delete();
