-- =====================================================================
-- Testes da migration 0008: financeiro completo e patrimônio
-- =====================================================================
reset role;
set request.jwt.claim.sub = '';
select set_config('test.jb_company', id::text, false) is not null as ok
from public.companies where name like 'JB RENT%' order by created_at limit 1 \gset
update public.companies set cash_opening_balance = 1000, cash_opening_date = '2030-01-01'
 where id = current_setting('test.jb_company')::uuid;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- ---------- Compra e venda do veículo ----------------------------------------
insert into public.vehicles (id, brand, model, plate, purchase_price, acquisition_date, fleet_entry_date, daily_price)
values ('aaaaaaaa-0000-0000-0000-000000000009', 'Renault', 'Clio', '4455 KLM', 15000.00, '2025-01-01', '2025-01-05', 30);
do $$
declare f public.financial_transactions;
begin
  select * into f from public.financial_transactions where source_ref = 'vehicle:aaaaaaaa-0000-0000-0000-000000000009:purchase';
  assert f.category = 'vehicle_purchase' and f.amount = 15000 and f.status = 'paid' and f.paid_at = '2025-01-01' and not f.is_operational,
    'compra automática, fora do resultado';
  -- lançamento automático não pode ser alterado manualmente (apenas observações)
  begin
    update public.financial_transactions set amount = 1 where id = f.id;
    raise exception 'TEST_FAIL: alterou lançamento automático';
  exception when raise_exception then
    if sqlerrm not like 'AUTO_ENTRY_LOCKED%' then raise; end if;
  end;
  update public.financial_transactions set notes = 'Factura del concesionario nº 88' where id = f.id;
  begin
    insert into public.financial_transactions (type, category, description, amount, competence_date, vehicle_id)
    values ('expense', 'vehicle_purchase', 'Compra duplicada', 15000, '2025-01-01', 'aaaaaaaa-0000-0000-0000-000000000009');
    raise exception 'TEST_FAIL: compra duplicada';
  exception when raise_exception then
    if sqlerrm not like 'DUPLICATE_PURCHASE%' then raise; end if;
  end;
  begin
    insert into public.financial_transactions (type, category, description, amount, competence_date, source_ref)
    values ('expense', 'fuel', 'x', 10, '2030-01-01', 'maintenance:forjado');
    raise exception 'TEST_FAIL: origem forjada';
  exception when raise_exception then
    if sqlerrm not like 'AUTO_ENTRY_LOCKED%' then raise; end if;
  end;
end $$;
-- preço alterado no veículo atualiza a compra
update public.vehicles set purchase_price = 14500 where id = 'aaaaaaaa-0000-0000-0000-000000000009';
do $$ begin
  assert (select amount from public.financial_transactions where source_ref = 'vehicle:aaaaaaaa-0000-0000-0000-000000000009:purchase') = 14500,
    'compra acompanha o preço';
  begin
    update public.vehicles set sold_at = (now() at time zone 'Europe/Madrid')::date, sale_price = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000003';
    raise exception 'TEST_FAIL: vendeu veículo alugado';
  exception when raise_exception then
    if sqlerrm not like 'VEHICLE_BUSY%' then raise; end if;
  end;
  begin
    update public.vehicles set sold_at = '2024-12-31', sale_price = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000009';
    raise exception 'TEST_FAIL: venda antes da compra';
  exception when raise_exception then
    if sqlerrm not like 'SALE_BEFORE_ACQUISITION%' then raise; end if;
  end;
end $$;
update public.vehicles set sold_at = (now() at time zone 'Europe/Madrid')::date, sale_price = 11000.00
 where id = 'aaaaaaaa-0000-0000-0000-000000000009';
do $$
declare v public.vehicles; r record;
begin
  select * into v from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000009';
  assert v.status = 'sold' and v.fleet_exit_date = v.sold_at, 'veículo vendido sai da frota';
  assert (select category::text || ':' || amount from public.financial_transactions
           where source_ref = 'vehicle:aaaaaaaa-0000-0000-0000-000000000009:sale' and status = 'paid') = 'vehicle_sale:11000.00',
    'venda lançada (não operacional)';
  select * into r from public.fleet_roi() where vehicle_id = 'aaaaaaaa-0000-0000-0000-000000000009';
  assert r.current_value = 11000 and r.purchase_price = 14500 and r.profit = 0, 'rentabilidade do vendido';
  assert r.months_in_fleet > 20, 'meses na frota';
end $$;
-- desfazer a venda (correção)
update public.vehicles set sold_at = null, sale_price = null where id = 'aaaaaaaa-0000-0000-0000-000000000009';
do $$ begin
  assert (select status from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000009') = 'available', 'venda desfeita';
  assert (select status from public.financial_transactions where source_ref = 'vehicle:aaaaaaaa-0000-0000-0000-000000000009:sale') = 'cancelled',
    'lançamento da venda anulado';
end $$;

-- ---------- Lançamentos manuais e relatórios (período isolado em 2030) -------
insert into public.financial_transactions (id, type, category, description, amount, competence_date, due_date, status, paid_at)
values ('99990000-0000-4000-8000-000000000001', 'income', 'other_income', 'Subarriendo plaza', 500.00, '2030-01-10', '2030-02-05', 'paid', '2030-02-05'),
       ('99990000-0000-4000-8000-000000000002', 'expense', 'fuel', 'Combustible enero', 120.00, '2030-01-20', null, 'pending', null),
       ('99990000-0000-4000-8000-000000000003', 'expense', 'loan_repayment', 'Cuota préstamo 1/12', 300.00, '2030-01-25', '2030-01-25', 'paid', '2030-01-25');
do $$
declare j jsonb; c record;
begin
  j := public.finance_report('2030-01-01', '2030-01-31', 'accrual');
  assert (j ->> 'income')::numeric = 500 and (j ->> 'expenses')::numeric = 120 and (j ->> 'result')::numeric = 380, 'competência: ' || j::text;
  assert (j -> 'non_operational' -> 0 ->> 'category') = 'loan_repayment', 'financiamento fora do resultado';
  j := public.finance_report('2030-01-01', '2030-01-31', 'cash');
  assert (j ->> 'income')::numeric = 0 and (j ->> 'expenses')::numeric = 0, 'caixa de janeiro sem resultado: ' || j::text;
  j := public.finance_report('2030-02-01', '2030-02-28', 'cash');
  assert (j ->> 'income')::numeric = 500, 'recebido em fevereiro';
  select * into c from public.cash_flow('2030-01-01', '2030-02-28') where month = '2030-01-01';
  assert c.outflow = 300 and c.net = -300 and c.balance = 700 and c.projected_out = 120, 'fluxo de janeiro: ' || row_to_json(c)::text;
  select * into c from public.cash_flow('2030-01-01', '2030-02-28') where month = '2030-02-01';
  assert c.inflow = 500 and c.balance = 1200, 'saldo acumulado em fevereiro';
  assert exists (select 1 from public.open_items('expense') where id = '99990000-0000-4000-8000-000000000002' and amount = 120), 'conta a pagar';
  assert not exists (select 1 from public.open_items('expense') where id = '99990000-0000-4000-8000-000000000003'), 'paga não está em aberto';
end $$;
-- regime de caixa usa os pagamentos efetivos dos contratos (parciais e estornos)
do $$
declare j jsonb; v_expected numeric;
begin
  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) into v_expected
    from public.rental_payments where voided_at is null and paid_at between '2026-11-01' and '2026-11-30';
  select v_expected + coalesce(sum(amount), 0) into v_expected from public.financial_transactions
   where type = 'income' and status = 'paid' and rental_line is null and archived_at is null and is_operational
     and paid_at between '2026-11-01' and '2026-11-30';
  j := public.finance_report('2026-11-01', '2026-11-30', 'cash');
  assert (j ->> 'income')::numeric = v_expected, 'receita de caixa = pagamentos recebidos: ' || (j ->> 'income') || ' vs ' || v_expected;
  assert exists (select 1 from public.open_items('income') where kind = 'rental'), 'saldos de contratos a receber';
end $$;
-- pagar e anular
update public.financial_transactions set status = 'paid', paid_at = '2030-01-31', payment_method = 'card' where id = '99990000-0000-4000-8000-000000000002';
update public.financial_transactions set status = 'cancelled', paid_at = null where id = '99990000-0000-4000-8000-000000000003';
do $$ begin
  begin
    update public.financial_transactions set status = 'pending' where id = '99990000-0000-4000-8000-000000000003';
    raise exception 'TEST_FAIL: reativou lançamento anulado';
  exception when raise_exception then
    if sqlerrm not like 'INVALID_STATUS_TRANSITION%' then raise; end if;
  end;
  begin
    perform public.finance_report('2030-01-01', '2030-01-31', 'x');
    raise exception 'TEST_FAIL: regime inválido';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- isolamento
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert (public.finance_report('2000-01-01', '2100-01-01', 'accrual') ->> 'income')::numeric = 0, 'relatório isolado';
  assert not exists (select 1 from public.fleet_roi()), 'rentabilidade isolada';
  assert not exists (select 1 from public.open_items('expense')), 'contas isoladas';
  assert not exists (select 1 from public.cash_flow('2030-01-01', '2030-02-28') where net <> 0 or balance <> 0), 'fluxo isolado';
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 008_finance_test'
