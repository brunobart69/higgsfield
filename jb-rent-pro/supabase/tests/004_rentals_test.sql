-- =====================================================================
-- Testes da migration 0004: cálculos do contrato, fluxo de status,
-- pagamentos, cauções, sincronização com veículo e financeiro
-- =====================================================================
reset role;
set request.jwt.claim.sub = '';

-- ---------- Fórmulas isoladas ------------------------------------------------
do $$ begin
  assert app.rental_charge_days('2026-11-10 10:00+01', '2026-11-14 10:00+01', 0) = 4, '4 dias exatos';
  assert app.rental_charge_days('2026-11-10 10:00+01', '2026-11-14 10:01+01', 0) = 5, '1 minuto a mais = mais 1 dia';
  assert app.rental_charge_days('2026-11-10 10:00+01', '2026-11-14 10:59+01', 60) = 4, 'tolerância de 60 min';
  assert app.rental_charge_days('2026-11-10 10:00+01', '2026-11-10 12:00+01', 0) = 1, 'mínimo de 1 dia';
  -- mudança de horário (CET → CEST em 29/03/2026): 24 h reais por dia
  assert app.rental_charge_days('2026-03-28 10:00+01', '2026-03-30 11:00+02', 0) = 2, 'horário de verão';
  assert app.rental_base_amount('daily', 35, 3) = 105.00, 'diária';
  assert app.rental_base_amount('weekly', 280, 10) = 400.00, 'semanal proporcional';
  assert app.rental_base_amount('monthly', 900, 15) = 450.00, 'mensal proporcional';
  assert app.rental_base_amount('weekly', 250, 3) = 107.14, 'arredondamento a 2 casas';
  assert app.rental_base_amount('custom', 199.99, 9) = 199.99, 'preço fechado';
  assert app.rental_allowed_km('unlimited', null, 5) is null, 'ilimitada';
  assert app.rental_allowed_km('daily', 200, 3) = 600, 'limite diário';
  assert app.rental_allowed_km('weekly', 1000, 10) = 2000, 'limite semanal por semana iniciada';
  assert app.rental_allowed_km('monthly', 3000, 31) = 6000, 'limite mensal por mês iniciado';
  assert app.rental_allowed_km('custom', 750, 9) = 750, 'limite personalizado total';
end $$;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- ---------- Novo contrato com extras e caução --------------------------------

insert into public.rentals (id, customer_id, vehicle_id, status, pickup_at, return_at, pricing_mode, unit_price,
                            discount_amount, deposit_amount, mileage_policy, mileage_limit_km, excess_km_price, payment_method)
values ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
        'confirmed', '2026-11-10 10:00+01', '2026-11-13 10:00+01', 'daily', 35, 5, 300, 'daily', 200, 0.25, 'card');
insert into public.rental_extras (rental_id, name, amount, charge_type, quantity) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Condutor adicional', 6.50, 'per_day', 1),
  ('eeeeeeee-0000-0000-0000-000000000001', 'Entrega aeroporto', 30.00, 'per_rental', 1);

do $$
declare r public.rentals;
begin
  select * into r from public.rentals where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert r.rental_days = 3, 'dias';
  assert r.base_amount = 105.00, 'base 3 × 35';
  assert r.extras_amount = 49.50, 'extras 6,50 × 3 + 30: ' || r.extras_amount;
  assert r.allowed_km = 600, 'km incluída';
  assert r.total_amount = 149.50, 'total 105 − 5 + 49,50: ' || r.total_amount;
  assert r.contract_number like 'JB-2026-%', 'número automático';
  assert (select status from public.deposits where rental_id = r.id) = 'not_received', 'caução criada pendente';
  assert (select count(*) from public.financial_transactions where rental_id = r.id and status = 'pending') = 2,
    'linhas de receita (aluguel + extras) geradas';
  assert (select amount from public.financial_transactions where rental_id = r.id and rental_line = 'rental') = 100.00,
    'linha do aluguel com desconto';
end $$;

-- desconto maior que o aluguel
do $$ begin
  begin
    update public.rentals set discount_amount = 200 where id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: desconto excessivo';
  exception when raise_exception then
    if sqlerrm not like 'DISCOUNT_TOO_HIGH%' then raise; end if;
  end;
end $$;

-- conflitos de agenda para a prévia
do $$ begin
  assert exists (select 1 from public.vehicle_conflicts('aaaaaaaa-0000-0000-0000-000000000002', '2026-11-12 09:00+01', '2026-11-15 09:00+01')),
    'conflito detectado';
  assert not exists (select 1 from public.vehicle_conflicts('aaaaaaaa-0000-0000-0000-000000000002', '2026-11-13 10:00+01', '2026-11-15 09:00+01')),
    'devolução e retirada na mesma hora não conflitam';
  assert not exists (select 1 from public.vehicle_conflicts('aaaaaaaa-0000-0000-0000-000000000002', '2026-11-12 09:00+01', '2026-11-15 09:00+01',
                                                             'eeeeeeee-0000-0000-0000-000000000001')),
    'o próprio contrato é ignorado ao editar';
end $$;

-- ---------- Pagamentos ------------------------------------------------------
insert into public.rental_payments (id, rental_id, amount, paid_at, method)
values ('99999999-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 100.00, '2026-11-10', 'card');
do $$ begin
  assert (select count(*) from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000001' and status = 'pending') = 2,
    'pagamento parcial mantém pendente';
  assert (public.rental_balance('eeeeeeee-0000-0000-0000-000000000001') ->> 'balance')::numeric = 49.50, 'saldo';
end $$;
insert into public.rental_payments (rental_id, amount, paid_at, method)
values ('eeeeeeee-0000-0000-0000-000000000001', 49.50, '2026-11-11', 'cash');
do $$ begin
  assert (select count(*) from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000001'
            and status = 'paid' and paid_at = '2026-11-11') = 2, 'quitado → pago na data do último pagamento';
end $$;

-- pagamento não muda; só é anulado com motivo
do $$ begin
  begin
    update public.rental_payments set amount = 10 where id = '99999999-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: pagamento alterado';
  exception when raise_exception then
    if sqlerrm not like 'PAYMENT_IMMUTABLE%' then raise; end if;
  end;
  begin
    update public.rental_payments set voided_at = now() where id = '99999999-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: anulação sem motivo';
  exception when check_violation then null;
  end;
end $$;
update public.rental_payments set voided_at = now(), void_reason = 'Cobrança duplicada no TPV'
 where id = '99999999-0000-0000-0000-000000000001';
do $$ begin
  assert (public.rental_balance('eeeeeeee-0000-0000-0000-000000000001') ->> 'balance')::numeric = 100.00, 'anulação volta o saldo';
  assert (select count(*) from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000001' and status = 'pending') = 2,
    'volta a pendente';
end $$;
-- admin não exclui pagamento (RLS: 0 linhas)
delete from public.rental_payments where id = '99999999-0000-0000-0000-000000000001';
do $$ begin
  assert exists (select 1 from public.rental_payments where id = '99999999-0000-0000-0000-000000000001'), 'pagamento não é excluído';
end $$;
insert into public.rental_payments (rental_id, amount, paid_at, method)
values ('eeeeeeee-0000-0000-0000-000000000001', 100.00, '2026-11-12', 'bizum');

-- ---------- Caução ---------------------------------------------------------
update public.deposits set amount_received = 300, received_at = '2026-11-10', received_method = 'card'
 where rental_id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.deposits where rental_id = 'eeeeeeee-0000-0000-0000-000000000001') = 'held', 'caução retida';
  assert not exists (select 1 from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000001'
                       and amount = 300), 'caução NÃO vira receita';
end $$;

-- ---------- Entrega ---------------------------------------------------------
do $$ begin
  begin
    update public.rentals set status = 'in_progress' where id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: entrega sem km';
  exception when raise_exception then
    if sqlerrm not like 'PICKUP_DATA_REQUIRED%' then raise; end if;
  end;
end $$;
update public.rentals set status = 'in_progress', start_mileage = 31500, start_fuel_level = 100
 where id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000002') = 'rented', 'veículo alugado';
  assert (select current_mileage from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000002') = 31500, 'km do veículo atualizada';
  assert (select picked_up_at from public.rentals where id = 'eeeeeeee-0000-0000-0000-000000000001') is not null, 'hora da entrega';
  begin
    update public.rentals set vehicle_id = 'aaaaaaaa-0000-0000-0000-000000000001' where id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: troca de veículo após entrega';
  exception when raise_exception then
    if sqlerrm not like 'RENTAL_LOCKED%' then raise; end if;
  end;
end $$;

-- ---------- Devolução com km excedente --------------------------------------
do $$ begin
  begin
    update public.rentals set status = 'completed' where id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: devolução sem dados';
  exception when raise_exception then
    if sqlerrm not like 'RETURN_DATA_REQUIRED%' then raise; end if;
  end;
end $$;
update public.rentals
   set status = 'completed', end_mileage = 32300, end_fuel_level = 75, actual_return_at = '2026-11-13 09:40+01'
 where id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$
declare r public.rentals;
begin
  select * into r from public.rentals where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert r.excess_km = 200, 'rodou 800, incluídos 600: ' || r.excess_km;
  assert r.excess_mileage_amount = 50.00, '200 km × 0,25';
  assert r.total_amount = 199.50, 'total com excedente: ' || r.total_amount;
  assert (select amount from public.financial_transactions where rental_id = r.id and rental_line = 'excess_mileage') = 50.00,
    'receita de km excedente';
  assert (public.rental_balance(r.id) ->> 'balance')::numeric = 50.00, 'excedente de km fica a pagar';
  assert (select count(*) from public.financial_transactions where rental_id = r.id and status = 'pending') = 3, 'pendente até quitar';
  assert (select status from public.vehicles where id = r.vehicle_id) = 'available', 'veículo liberado';
  assert (select current_mileage from public.vehicles where id = r.vehicle_id) = 32300, 'km final no veículo';
  -- competência no mês da devolução: novembro = só este contrato
  assert (public.dashboard_kpis('2026-11-01', '2026-11-30') ->> 'revenue')::numeric = 199.50,
    'receita de novembro = contrato (sem a caução de 300): ' || (public.dashboard_kpis('2026-11-01', '2026-11-30') ->> 'revenue');
end $$;

insert into public.rental_payments (rental_id, amount, paid_at, method)
values ('eeeeeeee-0000-0000-0000-000000000001', 50.00, '2026-11-13', 'card');
do $$ begin
  assert (public.rental_balance('eeeeeeee-0000-0000-0000-000000000001') ->> 'balance')::numeric = 0, 'saldo zerado';
  assert (select count(*) from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000001'
            and status = 'paid' and paid_at = '2026-11-13') = 3, 'tudo pago na data do último pagamento';
end $$;

-- contrato finalizado não muda
do $$ begin
  begin
    update public.rentals set unit_price = 10 where id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: contrato finalizado alterado';
  exception when raise_exception then
    if sqlerrm not like 'RENTAL_LOCKED%' then raise; end if;
  end;
  begin
    insert into public.rental_extras (rental_id, name, amount) values ('eeeeeeee-0000-0000-0000-000000000001', 'x', 1);
    raise exception 'TEST_FAIL: extra em contrato fechado';
  exception when raise_exception then
    if sqlerrm not like 'RENTAL_LOCKED%' then raise; end if;
  end;
  begin
    update public.rentals set status = 'in_progress' where id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: transição inválida';
  exception when raise_exception then
    if sqlerrm not like 'INVALID_STATUS_TRANSITION%' then raise; end if;
  end;
end $$;

-- alerta de caução a devolver
do $$ begin
  assert exists (select 1 from public.dashboard_alerts(50) where kind = 'deposit_pending'), 'alerta de caução';
  assert (public.dashboard_kpis('2026-11-01', '2026-11-30') ->> 'deposits_held')::int = 1, 'cauções em aberto';
end $$;

-- devolução da caução com retenção
do $$ begin
  begin
    update public.deposits set amount_retained = 50 where rental_id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: retenção sem motivo';
  exception when check_violation then null;
  end;
  begin
    update public.deposits set amount_returned = 400, returned_at = '2026-11-13' where rental_id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: devolução maior que o recebido';
  exception when check_violation then null;
  end;
end $$;
update public.deposits
   set amount_returned = 250, returned_at = '2026-11-13', returned_method = 'card',
       amount_retained = 50, retention_reason = 'Limpeza interior'
 where rental_id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.deposits where rental_id = 'eeeeeeee-0000-0000-0000-000000000001') = 'settled', 'caução encerrada';
  assert (public.rental_balance('eeeeeeee-0000-0000-0000-000000000001') ->> 'deposit_balance')::numeric = 0, 'saldo da caução';
end $$;

-- ---------- Cancelamento ----------------------------------------------------
insert into public.rentals (id, customer_id, vehicle_id, status, pickup_at, return_at, unit_price)
values ('eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
        'confirmed', '2026-11-20 10:00+01', '2026-11-22 10:00+01', 35);
do $$ begin
  assert exists (select 1 from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000002' and status = 'pending'),
    'confirmado gera receita a receber';
  begin
    update public.rentals set status = 'cancelled' where id = 'eeeeeeee-0000-0000-0000-000000000002';
    raise exception 'TEST_FAIL: cancelamento sem motivo';
  exception when raise_exception then
    if sqlerrm not like 'CANCEL_REASON_REQUIRED%' then raise; end if;
  end;
end $$;
update public.rentals set status = 'cancelled', cancelled_reason = 'Cliente cancelou'
 where id = 'eeeeeeee-0000-0000-0000-000000000002';
do $$ begin
  assert not exists (select 1 from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000002' and status <> 'cancelled'),
    'cancelado: receita anulada';
end $$;

-- reserva não gera receita até ser confirmada
insert into public.rentals (id, customer_id, vehicle_id, status, pickup_at, return_at, unit_price)
values ('eeeeeeee-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
        'reservation', '2026-11-25 10:00+01', '2026-11-26 10:00+01', 35);
do $$ begin
  assert not exists (select 1 from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000003'),
    'reserva sem receita';
  begin
    insert into public.rentals (customer_id, vehicle_id, status, pickup_at, return_at, unit_price)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'completed',
            '2026-12-01 10:00+01', '2026-12-02 10:00+01', 35);
    raise exception 'TEST_FAIL: contrato criado já finalizado';
  exception when raise_exception then
    if sqlerrm not like 'INVALID_STATUS_TRANSITION%' then raise; end if;
  end;
end $$;
update public.rentals set status = 'confirmed' where id = 'eeeeeeee-0000-0000-0000-000000000003';
do $$ begin
  assert exists (select 1 from public.financial_transactions where rental_id = 'eeeeeeee-0000-0000-0000-000000000003' and status = 'pending'),
    'confirmação gera receita';
end $$;

-- isolamento
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert (select count(*) from public.rental_payments) = 0, 'pagamentos isolados';
  assert (select count(*) from public.deposits) = 0, 'cauções isoladas';
  assert public.rental_balance('eeeeeeee-0000-0000-0000-000000000001') is null, 'saldo isolado';
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 004_rentals_test'

-- ---------- save_rental: contrato + extras atômicos -------------------------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare v_id uuid;
begin
  v_id := public.save_rental(null, jsonb_build_object(
    'customer_id', 'cccccccc-0000-0000-0000-000000000001', 'vehicle_id', 'aaaaaaaa-0000-0000-0000-000000000003',
    'status', 'reservation', 'pickup_at', '2026-12-01 10:00+01', 'return_at', '2026-12-08 10:00+01',
    'pricing_mode', 'weekly', 'unit_price', '280.00', 'mileage_policy', 'unlimited', 'contract_locale', 'pt-BR'),
    '[{"name":"Cadeirinha","amount":"5.00","charge_type":"per_day","quantity":2}]'::jsonb);
  assert (select total_amount from public.rentals where id = v_id) = 350.00, 'semana 280 + 5 × 2 × 7';
  -- extra inválido: nada é gravado (transação inteira desfeita)
  begin
    perform public.save_rental(v_id, jsonb_build_object(
      'customer_id', 'cccccccc-0000-0000-0000-000000000001', 'vehicle_id', 'aaaaaaaa-0000-0000-0000-000000000003',
      'pickup_at', '2026-12-01 10:00+01', 'return_at', '2026-12-10 10:00+01',
      'pricing_mode', 'weekly', 'unit_price', '280.00', 'mileage_policy', 'unlimited'),
      '[{"name":"x","amount":"-1","charge_type":"per_rental","quantity":1}]'::jsonb);
    raise exception 'TEST_FAIL: extra negativo aceito';
  exception when check_violation then null;
  end;
  assert (select return_at from public.rentals where id = v_id) = '2026-12-08 10:00+01', 'alteração desfeita por inteiro';
  assert (select count(*) from public.rental_extras where rental_id = v_id) = 1, 'extras preservados';
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 004 save_rental'
