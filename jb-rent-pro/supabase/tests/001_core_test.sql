-- =====================================================================
-- Testes da migration 0001: usuários, permissões (RLS), conflitos de
-- reserva, regras de disponibilidade e cálculos financeiros do dashboard.
-- Cada bloco DO lança exceção se a verificação falhar.
-- =====================================================================
\set owner   '''11111111-1111-1111-1111-111111111111'''
\set admin   '''22222222-2222-2222-2222-222222222222'''
\set nobody  '''33333333-3333-3333-3333-333333333333'''
\set other   '''44444444-4444-4444-4444-444444444444'''

-- ---------- 1. Bootstrap de usuários -----------------------------------
insert into auth.users (id, email, raw_user_meta_data)
values (:owner, 'dono@jbrent.es', '{"full_name":"Proprietário"}');

do $$ begin
  assert (select count(*) from public.companies) = 1, 'primeiro usuário deve criar a empresa';
  assert (select role from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 'owner',
    'primeiro usuário deve ser ADMINISTRADOR PRINCIPAL';
end $$;

-- convite de administrador (feito pelo servidor com service_role)
insert into auth.users (id, email, raw_app_meta_data)
select :admin, 'admin@jbrent.es', jsonb_build_object('company_id', id, 'role', 'admin')
from public.companies limit 1;

-- cadastro sem convite: não recebe perfil
insert into auth.users (id, email, raw_app_meta_data)
values (:nobody, 'intruso@example.com', '{"role":"owner"}');

-- outra empresa (isolamento multiempresa)
insert into public.companies (id, name) values ('99999999-9999-9999-9999-999999999999', 'Outra');
insert into auth.users (id, email, raw_app_meta_data)
values (:other, 'outra@example.com', '{"company_id":"99999999-9999-9999-9999-999999999999","role":"owner"}');

select set_config('test.jb_company', id::text, false) is not null as ok from public.companies where name = 'JB RENT' \gset

do $$ begin
  assert (select role from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 'admin',
    'convidado deve ser administrador';
  assert not exists (select 1 from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
    'usuário sem convite não pode ter perfil';
end $$;

-- ---------- 2. Administrador: cadastros e reservas ---------------------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

insert into public.vehicles (id, brand, model, plate, purchase_price, fleet_entry_date, daily_price)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Toyota', 'Corolla', '1234 ABC', 22000.00, '2026-01-01', 45.00),
       ('aaaaaaaa-0000-0000-0000-000000000002', 'Seat', 'Ibiza', '5678 DEF', 15000.00, '2026-01-01', 35.00);

insert into public.customers (id, customer_type, full_name, id_document_type, id_document_number)
values ('cccccccc-0000-0000-0000-000000000001', 'individual', 'Maria García', 'dni', '12345678Z');

do $$ begin
  assert (select created_by from public.vehicles where plate = '1234 ABC') = '22222222-2222-2222-2222-222222222222',
    'created_by deve registrar o autor';
  assert (select company_id from public.vehicles where plate = '1234 ABC') = app.current_company_id(),
    'company_id deve ser preenchido automaticamente';
end $$;

insert into public.rentals (id, customer_id, vehicle_id, status, pickup_at, return_at, unit_price, total_amount)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed',
        '2026-10-01 10:00+02', '2026-10-05 10:00+02', 45, 180);

-- matrícula duplicada (ignorando espaços/maiúsculas)
do $$ begin
  begin
    insert into public.vehicles (brand, model, plate) values ('X', 'Y', '1234abc');
    raise exception 'TEST_FAIL: matrícula duplicada aceita';
  exception when unique_violation then null;
  end;
end $$;

-- reserva sobreposta deve falhar
do $$ begin
  begin
    insert into public.rentals (customer_id, vehicle_id, status, pickup_at, return_at, unit_price)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'reservation',
            '2026-10-04 09:00+02', '2026-10-08 09:00+02', 45);
    raise exception 'TEST_FAIL: sobreposição aceita';
  exception when exclusion_violation then null;
  end;
end $$;

-- devolução às 10:00 e nova retirada às 10:00 no mesmo veículo: permitido
insert into public.rentals (customer_id, vehicle_id, status, pickup_at, return_at, unit_price)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'reservation',
        '2026-10-05 10:00+02', '2026-10-06 10:00+02', 45);

-- reserva cancelada não bloqueia o período
insert into public.rentals (customer_id, vehicle_id, status, pickup_at, return_at, unit_price)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'cancelled',
        '2026-10-02 10:00+02', '2026-10-03 10:00+02', 45);

-- alterar datas de um contrato para conflitar também falha
do $$ begin
  begin
    update public.rentals set return_at = '2026-10-05 12:00+02'
    where id = 'dddddddd-0000-0000-0000-000000000001';
    raise exception 'TEST_FAIL: alteração conflitante aceita';
  exception when exclusion_violation then null;
  end;
end $$;

-- veículo em manutenção não pode ser alugado
update public.vehicles set status = 'maintenance' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin
  begin
    insert into public.rentals (customer_id, vehicle_id, pickup_at, return_at, unit_price)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
            '2026-11-10 10:00+01', '2026-11-12 10:00+01', 35);
    raise exception 'TEST_FAIL: veículo em manutenção alugado';
  exception when raise_exception then
    if sqlerrm not like 'VEHICLE_NOT_RENTABLE%' then raise; end if;
  end;
end $$;
update public.vehicles set status = 'available' where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- período inválido
do $$ begin
  begin
    insert into public.rentals (customer_id, vehicle_id, pickup_at, return_at, unit_price)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
            '2026-11-12 10:00+01', '2026-11-10 10:00+01', 35);
    raise exception 'TEST_FAIL: período invertido aceito';
  exception when check_violation then null;
  end;
end $$;

-- ---------- 3. Financeiro e cálculos do dashboard ----------------------
insert into public.financial_transactions (type, category, description, amount, competence_date, status, paid_at, vehicle_id)
values ('income',  'rental',           'Aluguel JB-1',     1000.10, '2026-10-05', 'paid',    '2026-10-05', 'aaaaaaaa-0000-0000-0000-000000000001'),
       ('income',  'other_income',     'Outros',              0.20, '2026-10-06', 'pending', null,         null),
       ('expense', 'maintenance',      'Troca de óleo',     300.05, '2026-10-10', 'paid',    '2026-10-10', 'aaaaaaaa-0000-0000-0000-000000000001'),
       ('expense', 'vehicle_purchase', 'Compra Corolla',  22000.00, '2026-10-01', 'paid',    '2026-10-01', 'aaaaaaaa-0000-0000-0000-000000000001'),
       ('expense', 'cleaning',         'Cancelado',          99.99, '2026-10-11', 'cancelled', null,       null),
       ('income',  'rental',           'Fora do período',   500.00, '2026-09-30', 'paid',    '2026-09-30', null);

-- categoria incompatível com o tipo
do $$ begin
  begin
    insert into public.financial_transactions (type, category, description, amount, competence_date)
    values ('income', 'fuel', 'x', 10, '2026-10-01');
    raise exception 'TEST_FAIL: categoria inválida aceita';
  exception when check_violation then null;
  end;
end $$;

do $$
declare k jsonb;
begin
  k := public.dashboard_kpis('2026-10-01', '2026-10-31');
  assert (k ->> 'revenue')::numeric = 1000.30, 'receita deveria ser 1000.30, obtido ' || (k ->> 'revenue');
  assert (k ->> 'expenses')::numeric = 300.05, 'despesa deveria ignorar compra de veículo e cancelados: ' || (k ->> 'expenses');
  assert (k ->> 'operating_profit')::numeric = 700.25, 'lucro deveria ser 700.25';
  assert (k ->> 'vehicles_total')::int = 2, 'total de veículos';
  assert (k ->> 'active_contracts')::int = 1, 'contratos ativos';
end $$;

do $$
declare r record;
begin
  select * into r from public.dashboard_vehicle_performance('2026-10-01', '2026-10-31')
  where vehicle_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert r.revenue = 1000.10 and r.expenses = 300.05 and r.profit = 700.05, 'desempenho por veículo';
  -- contrato confirmado 01→05/10 = 4 dias (o de reserva não conta como ocupação)
  assert r.rented_days = 4, 'dias alugados deveria ser 4, obtido ' || r.rented_days;
  assert r.available_days = 31, 'dias disponíveis deveria ser 31';
  assert r.occupancy_pct = 12.9, 'ocupação deveria ser 12.9%, obtido ' || r.occupancy_pct;

  select * into r from public.dashboard_monthly('2026-09-01', '2026-10-31') where month = '2026-10-01';
  assert r.revenue = 1000.30 and r.expenses = 300.05 and r.profit = 700.25, 'série mensal';
  assert r.fleet_value = 37000.00, 'patrimônio = soma dos valores de compra sem avaliação: ' || r.fleet_value;
  assert (select count(*) from public.dashboard_monthly('2026-09-01', '2026-10-31')) = 2, 'dois meses';
end $$;

insert into public.vehicle_valuations (vehicle_id, valuation_date, value)
values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-15', 20500.00);
do $$ begin
  assert (select fleet_value from public.dashboard_monthly('2026-10-01', '2026-10-31')) = 35500.00,
    'patrimônio deve usar a avaliação mais recente';
end $$;

-- ---------- 4. Permissões do administrador -----------------------------
-- administrador não exclui (RLS: 0 linhas afetadas)
delete from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin
  assert exists (select 1 from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'administrador não pode excluir veículos';
end $$;

-- administrador não pode se promover
do $$ begin
  begin
    update public.profiles set role = 'owner' where id = auth.uid();
    raise exception 'TEST_FAIL: autopromoção aceita';
  exception when insufficient_privilege then null;
  end;
end $$;

-- administrador não escreve diretamente no log de atividades
do $$ begin
  begin
    insert into public.activity_logs (action, entity) values ('fake', 'x');
    raise exception 'TEST_FAIL: log manual aceito';
  exception when insufficient_privilege then null;
  end;
end $$;

-- administrador vê apenas o próprio histórico
do $$ begin
  assert (select count(*) from public.activity_logs) > 0, 'admin deve ver suas ações';
  assert not exists (select 1 from public.activity_logs where user_id is distinct from auth.uid()),
    'admin não deve ver ações de outros';
end $$;

-- ---------- 5. Proprietário --------------------------------------------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- exclusão definitiva de lançamento financeiro bloqueada sem autorização especial
do $$ begin
  begin
    delete from public.financial_transactions where description = 'Outros';
    raise exception 'TEST_FAIL: exclusão financeira aceita';
  exception when insufficient_privilege then
    if sqlerrm not like 'HARD_DELETE_FORBIDDEN%' then raise; end if;
  end;
end $$;

-- com autorização especial explícita do proprietário
begin;
set local app.allow_hard_delete = 'on';
delete from public.financial_transactions where description = 'Outros';
commit;
do $$ begin
  assert not exists (select 1 from public.financial_transactions where description = 'Outros'),
    'proprietário com autorização especial pode excluir';
  assert exists (select 1 from public.activity_logs where entity = 'financial_transactions' and action = 'delete'),
    'exclusão deve ficar registrada';
  assert (select count(distinct user_id) from public.activity_logs) >= 2, 'proprietário vê o log completo';
end $$;

-- o proprietário não pode se rebaixar
do $$ begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'TEST_FAIL: proprietário se rebaixou';
  exception when insufficient_privilege then null;
  end;
end $$;

-- proprietário pode desativar o administrador
update public.profiles set is_active = false where id = '22222222-2222-2222-2222-222222222222';
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from public.vehicles) = 0, 'administrador desativado não acessa dados';
end $$;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.profiles set is_active = true where id = '22222222-2222-2222-2222-222222222222';

-- ---------- 6. Isolamento entre empresas e usuários sem acesso ---------
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert (select count(*) from public.vehicles) = 0, 'outra empresa não vê veículos';
  assert (select count(*) from public.customers) = 0, 'outra empresa não vê clientes';
  assert (select count(*) from public.financial_transactions) = 0, 'outra empresa não vê financeiro';
  assert ((public.dashboard_kpis('2026-10-01', '2026-10-31')) ->> 'revenue')::numeric = 0,
    'dashboard isolado por empresa';
  begin
    insert into public.vehicles (company_id, brand, model, plate)
    values (current_setting('test.jb_company')::uuid, 'Hack', 'Car', 'HACK1');
    raise exception 'TEST_FAIL: inserção em outra empresa aceita';
  exception when insufficient_privilege then null;
  end;
end $$;

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  assert (select count(*) from public.vehicles) = 0, 'usuário sem convite não vê nada';
  assert (select count(*) from public.companies) = 0, 'usuário sem convite não vê empresas';
end $$;

-- ---------- 7. Anônimo --------------------------------------------------
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.vehicles;
    raise exception 'TEST_FAIL: anon leu veículos';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.dashboard_kpis('2026-10-01', '2026-10-31');
    raise exception 'TEST_FAIL: anon executou RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

\echo '   ok: 001_core_test'
