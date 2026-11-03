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
