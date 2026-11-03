-- =====================================================================
-- Testes da migration 0007: manutenção, multas e sinistros
-- =====================================================================
reset role;
set request.jwt.claim.sub = '';
select set_config('test.jb_company', id::text, false) is not null as ok
from public.companies where name like 'JB RENT%' order by created_at limit 1 \gset
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- ---------- Planos de manutenção --------------------------------------------
-- V2 está com 32.300 km
insert into public.maintenance_plans (id, vehicle_id, name, maintenance_type, interval_km, interval_months, last_done_date, last_done_mileage)
values ('55550000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'Cambio de aceite', 'oil_change', 15000, 12,
        (now() at time zone 'Europe/Madrid')::date - 300, 18100);
do $$
declare d record;
begin
  select * into d from public.maintenance_due() where plan_id = '55550000-0000-4000-8000-000000000001';
  assert d.next_km = 33100 and d.km_left = 800, 'próximo serviço por km';
  assert d.due_status = 'due_soon', 'em breve por km (≤ 1000 km)';
  assert exists (select 1 from public.extra_alert_rows() where kind = 'maintenance_due' and entity_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'alerta de manutenção próxima';
  begin
    insert into public.maintenance_plans (vehicle_id, name, interval_km) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Sem base', 10000);
    raise exception 'TEST_FAIL: plano sem km de referência';
  exception when check_violation then null;
  end;
end $$;
update public.vehicles set current_mileage = 33200 where id = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin
  assert (select due_status from public.maintenance_due() where plan_id = '55550000-0000-4000-8000-000000000001') = 'overdue', 'vencido por km';
end $$;

-- ---------- Ordem de manutenção ----------------------------------------------
insert into public.maintenance_records (id, vehicle_id, plan_id, maintenance_type, title, scheduled_date)
values ('66660000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', '55550000-0000-4000-8000-000000000001',
        'oil_change', 'Cambio de aceite y filtros', (now() at time zone 'Europe/Madrid')::date + 1);
do $$ begin
  assert not exists (select 1 from public.extra_alert_rows() where kind in ('maintenance_due', 'maintenance_overdue')
                       and entity_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'plano com ordem aberta não alerta';
  assert exists (select 1 from public.extra_alert_rows() where kind = 'maintenance_scheduled'), 'agendada para amanhã';
end $$;
update public.vehicles set status = 'available' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
update public.maintenance_records set status = 'in_progress', workshop = 'Talleres Sur' where id = '66660000-0000-4000-8000-000000000001';
do $$ begin
  assert (select status from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000002') = 'maintenance', 'veículo em oficina';
  begin
    insert into public.rentals (customer_id, vehicle_id, status, pickup_at, return_at, unit_price)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'reservation', '2027-06-01 10:00+02', '2027-06-03 10:00+02', 35);
    raise exception 'TEST_FAIL: reserva de veículo em manutenção';
  exception when raise_exception then
    if sqlerrm not like 'VEHICLE_NOT_RENTABLE%' then raise; end if;
  end;
  begin
    update public.maintenance_records set status = 'completed' where id = '66660000-0000-4000-8000-000000000001';
    raise exception 'TEST_FAIL: concluiu plano por km sem km';
  exception when raise_exception then
    if sqlerrm not like 'MAINTENANCE_DATA_REQUIRED%' then raise; end if;
  end;
end $$;
update public.maintenance_records set status = 'completed', mileage = 33250, cost = 189.90,
       completed_date = (now() at time zone 'Europe/Madrid')::date
 where id = '66660000-0000-4000-8000-000000000001';
do $$
declare f public.financial_transactions;
begin
  assert (select status from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000002') = 'available', 'veículo liberado';
  assert (select current_mileage from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000002') = 33250, 'km atualizada';
  assert (select last_done_mileage from public.maintenance_plans where id = '55550000-0000-4000-8000-000000000001') = 33250, 'plano reiniciado';
  assert (select due_status from public.maintenance_due() where plan_id = '55550000-0000-4000-8000-000000000001') = 'ok', 'plano em dia';
  select * into f from public.financial_transactions where source_ref = 'maintenance:66660000-0000-4000-8000-000000000001';
  assert f.type = 'expense' and f.category = 'maintenance' and f.amount = 189.90 and f.status = 'pending', 'despesa da manutenção';
  begin
    update public.maintenance_records set mileage = 1 where id = '66660000-0000-4000-8000-000000000001';
    raise exception 'TEST_FAIL: alterou manutenção concluída';
  exception when raise_exception then
    if sqlerrm not like 'MAINTENANCE_LOCKED%' then raise; end if;
  end;
end $$;
update public.maintenance_records set paid_at = (now() at time zone 'Europe/Madrid')::date, payment_method = 'card'
 where id = '66660000-0000-4000-8000-000000000001';
do $$ begin
  assert (select status from public.financial_transactions where source_ref = 'maintenance:66660000-0000-4000-8000-000000000001') = 'paid', 'pagamento';
end $$;

-- veículo alugado não entra na oficina; reparo da avaria resolve a avaria
do $$ begin
  begin
    insert into public.maintenance_records (vehicle_id, maintenance_type, title, status)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'repair', 'Reparo', 'in_progress');
    raise exception 'TEST_FAIL: oficina com veículo alugado';
  exception when raise_exception then
    if sqlerrm not like 'VEHICLE_BUSY%' then raise; end if;
  end;
  begin
    insert into public.maintenance_records (vehicle_id, damage_id, maintenance_type, title, scheduled_date)
    values ('aaaaaaaa-0000-0000-0000-000000000002', '22220000-0000-4000-8000-000000000001', 'repair', 'X', current_date);
    raise exception 'TEST_FAIL: avaria de outro veículo';
  exception when raise_exception then
    if sqlerrm not like 'MAINTENANCE_LINK_MISMATCH%' then raise; end if;
  end;
end $$;
insert into public.maintenance_records (id, vehicle_id, damage_id, maintenance_type, title, status, blocks_vehicle, completed_date, cost, workshop)
values ('66660000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', '22220000-0000-4000-8000-000000000001',
        'bodywork', 'Reparación paragolpes', 'completed', false, (now() at time zone 'Europe/Madrid')::date, 410.00, 'Chapa Madrid');
do $$
declare d public.damages;
begin
  select * into d from public.damages where id = '22220000-0000-4000-8000-000000000001';
  assert d.status = 'resolved' and d.actual_cost = 410.00 and d.repair_shop = 'Chapa Madrid', 'avaria resolvida pelo reparo';
  assert (select category from public.financial_transactions where source_ref = 'maintenance:66660000-0000-4000-8000-000000000002') = 'repairs',
    'reparo na categoria Reparos';
  begin
    update public.maintenance_records set status = 'cancelled' where id = '66660000-0000-4000-8000-000000000002';
    raise exception 'TEST_FAIL: cancelou concluída';
  exception when raise_exception then
    if sqlerrm not like 'MAINTENANCE_LOCKED%' then raise; end if;
  end;
end $$;
-- cancelamento exige motivo e anula
insert into public.maintenance_records (id, vehicle_id, maintenance_type, title, scheduled_date)
values ('66660000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'tyres', 'Neumáticos', current_date + 20);
do $$ begin
  begin
    update public.maintenance_records set status = 'cancelled' where id = '66660000-0000-4000-8000-000000000003';
    raise exception 'TEST_FAIL: cancelou sem motivo';
  exception when raise_exception then
    if sqlerrm not like 'CANCEL_REASON_REQUIRED%' then raise; end if;
  end;
end $$;
update public.maintenance_records set status = 'cancelled', cancel_reason = 'Duplicado' where id = '66660000-0000-4000-8000-000000000003';
delete from public.maintenance_records where id = '66660000-0000-4000-8000-000000000003';
do $$ begin
  assert exists (select 1 from public.maintenance_records where id = '66660000-0000-4000-8000-000000000003'), 'manutenção não é excluída';
end $$;

-- ---------- Multas ------------------------------------------------------------
insert into public.traffic_fines (id, vehicle_id, infraction_at, authority, reference, infraction, amount,
                                  identification_deadline, payment_deadline)
values ('77770000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', now() + interval '1 minute',
        'DGT', ' m-2026/1234 ', 'Exceso de velocidad (radar)', 100.00,
        (now() at time zone 'Europe/Madrid')::date + 3, (now() at time zone 'Europe/Madrid')::date + 20);
do $$
declare f public.traffic_fines;
begin
  select * into f from public.traffic_fines where id = '77770000-0000-4000-8000-000000000001';
  assert f.rental_id = 'eeeeeeee-0000-0000-0000-000000000005', 'contrato identificado pela data/hora';
  assert f.customer_id = 'cccccccc-0000-0000-0000-000000000001', 'cliente identificado';
  assert f.reference = 'M-2026/1234', 'referência normalizada';
  assert exists (select 1 from public.extra_alert_rows() where kind = 'fine_identification_due' and entity_id = f.id), 'alerta de identificação';
  begin
    insert into public.traffic_fines (vehicle_id, infraction_at, authority, reference, infraction, amount)
    values ('aaaaaaaa-0000-0000-0000-000000000003', now(), 'DGT', 'M-2026/1234', 'Duplicada', 100);
    raise exception 'TEST_FAIL: multa duplicada';
  exception when unique_violation then null;
  end;
  begin
    insert into public.traffic_fines (vehicle_id, infraction_at, authority, infraction, amount, status)
    values ('aaaaaaaa-0000-0000-0000-000000000002', '2020-01-01 10:00+01', 'Ayuntamiento', 'Estacionamiento', 90, 'driver_identified');
    raise exception 'TEST_FAIL: identificou condutor sem cliente';
  exception when raise_exception then
    if sqlerrm not like 'FINE_NO_DRIVER%' then raise; end if;
  end;
end $$;
update public.traffic_fines set status = 'driver_identified' where id = '77770000-0000-4000-8000-000000000001';
do $$ begin
  assert (select identified_at from public.traffic_fines where id = '77770000-0000-4000-8000-000000000001') is not null, 'data de identificação';
  assert not exists (select 1 from public.extra_alert_rows() where entity_id = '77770000-0000-4000-8000-000000000001'), 'sem alertas após identificar';
  assert not exists (select 1 from public.financial_transactions where source_ref like 'fine:77770000-0000-4000-8000-000000000001%'), 'sem lançamentos';
end $$;
-- multa paga pela empresa e repassada ao cliente
insert into public.traffic_fines (id, vehicle_id, rental_id, infraction_at, authority, infraction, amount)
values ('77770000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000005',
        now() + interval '2 minutes', 'Ayuntamiento de Madrid', 'Estacionamiento en zona SER', 90.00);
update public.traffic_fines set status = 'paid', paid_at = (now() at time zone 'Europe/Madrid')::date, paid_amount = 45.00,
       payment_method = 'card', recharge_amount = 65.00
 where id = '77770000-0000-4000-8000-000000000002';
do $$ begin
  assert (select amount from public.financial_transactions where source_ref = 'fine:77770000-0000-4000-8000-000000000002:expense' and category = 'fines' and status = 'paid') = 45.00,
    'despesa da multa';
  assert (select status from public.financial_transactions where source_ref = 'fine:77770000-0000-4000-8000-000000000002:recharge'
           and type = 'income' and category = 'fine_recharge' and customer_id = 'cccccccc-0000-0000-0000-000000000001') = 'pending',
    'repasse ao cliente pendente';
end $$;
update public.traffic_fines set recharge_paid_at = (now() at time zone 'Europe/Madrid')::date where id = '77770000-0000-4000-8000-000000000002';
update public.traffic_fines set status = 'cancelled' where id = '77770000-0000-4000-8000-000000000002';
do $$ begin
  assert not exists (select 1 from public.financial_transactions where source_ref like 'fine:77770000-0000-4000-8000-000000000002%' and status <> 'cancelled'),
    'multa anulada cancela lançamentos';
end $$;

-- ---------- Sinistros ---------------------------------------------------------
insert into public.accidents (id, vehicle_id, occurred_at, location, description, third_party, deductible_amount)
values ('88880000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', now() + interval '3 minutes',
        'M-30, salida 7', 'Alcance trasero en retención', true, 300.00);
do $$
declare a public.accidents;
begin
  select * into a from public.accidents where id = '88880000-0000-4000-8000-000000000001';
  assert a.rental_id = 'eeeeeeee-0000-0000-0000-000000000005' and a.customer_id = 'cccccccc-0000-0000-0000-000000000001', 'contrato do sinistro';
  assert exists (select 1 from public.extra_alert_rows() where kind = 'accident_unreported' and entity_id = a.id), 'alerta de comunicação';
  assert (select status from public.financial_transactions where source_ref = 'accident:' || a.id || ':deductible' and category = 'damage_recovery') = 'pending',
    'franquia a receber do cliente';
end $$;
update public.accidents set reported_to_insurer_at = (now() at time zone 'Europe/Madrid')::date, insurer_claim_number = 'SIN-889',
       insurer_payout = 1200.00, insurer_payout_at = (now() at time zone 'Europe/Madrid')::date, status = 'closed', police_report_number = 'AT-55'
 where id = '88880000-0000-4000-8000-000000000001';
do $$
declare a public.accidents;
begin
  select * into a from public.accidents where id = '88880000-0000-4000-8000-000000000001';
  assert a.closed_at is not null and a.police_report, 'fechado e com atestado';
  assert not exists (select 1 from public.extra_alert_rows() where entity_id = a.id), 'sem alerta após comunicar';
  assert (select amount from public.financial_transactions where source_ref = 'accident:' || a.id || ':payout' and status = 'paid') = 1200.00,
    'indenização recebida';
end $$;

-- documentos vinculados devem ser do mesmo veículo
do $$ begin
  begin
    insert into public.documents (category, title, storage_path, mime_type, size_bytes, vehicle_id, fine_id)
    values ('fine_notice', 'Notificación', current_setting('test.jb_company') || '/vehicles/aaaaaaaa-0000-0000-0000-000000000002/documents/n.pdf',
            'application/pdf', 100, 'aaaaaaaa-0000-0000-0000-000000000002', '77770000-0000-4000-8000-000000000001');
    raise exception 'TEST_FAIL: documento de multa de outro veículo';
  exception when foreign_key_violation then null;
  end;
end $$;

-- isolamento
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert not exists (select 1 from public.maintenance_records), 'manutenções isoladas';
  assert not exists (select 1 from public.traffic_fines), 'multas isoladas';
  assert not exists (select 1 from public.accidents), 'sinistros isolados';
  assert not exists (select 1 from public.maintenance_due()), 'planos isolados';
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 007_maintenance_fines_accidents_test'
