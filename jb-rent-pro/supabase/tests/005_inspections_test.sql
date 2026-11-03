-- =====================================================================
-- Testes da migration 0005: inspeções, fotos e avarias
-- =====================================================================
reset role;
set request.jwt.claim.sub = '';
select set_config('test.jb_company', id::text, false) is not null as ok
from public.companies where name like 'JB RENT%' order by created_at limit 1 \gset

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- contrato confirmado para o Kia (V3), sem conflito com os testes anteriores
insert into public.rentals (id, customer_id, vehicle_id, status, pickup_at, return_at, unit_price)
values ('eeeeeeee-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003',
        'confirmed', '2027-01-10 10:00+01', '2027-01-12 10:00+01', 62);

-- ---------- Checklist validado ------------------------------------------------
do $$ begin
  begin
    insert into public.inspections (vehicle_id, rental_id, inspection_type, checklist)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000005', 'delivery',
            '{"motor_de_dobra": {"condition": "ok"}}');
    raise exception 'TEST_FAIL: área inválida aceita';
  exception when check_violation then null;
  end;
  begin
    insert into public.inspections (vehicle_id, rental_id, inspection_type, checklist)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000005', 'delivery',
            '{"front": {"condition": "perfeito"}}');
    raise exception 'TEST_FAIL: condição inválida aceita';
  exception when check_violation then null;
  end;
  -- devolução só depois da entrega
  begin
    insert into public.inspections (vehicle_id, rental_id, inspection_type)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000005', 'return');
    raise exception 'TEST_FAIL: devolução antes da entrega';
  exception when raise_exception then
    if sqlerrm not like 'INSPECTION_RENTAL_NOT_ACTIVE%' then raise; end if;
  end;
  -- veículo diferente do contrato
  begin
    insert into public.inspections (vehicle_id, rental_id, inspection_type)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005', 'delivery');
    raise exception 'TEST_FAIL: veículo incoerente';
  exception when raise_exception then
    if sqlerrm not like 'INSPECTION_RENTAL_MISMATCH%' then raise; end if;
  end;
end $$;

-- ---------- Inspeção de entrega ----------------------------------------------
insert into public.inspections (id, vehicle_id, rental_id, inspection_type, checklist)
values ('11110000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000005',
        'delivery', '{"front": {"condition": "ok"}, "left_side": {"condition": "minor", "notes": "Risco leve na porta traseira"}, "wheels_tyres": {"condition": "ok"}}');

do $$ begin
  begin
    insert into public.inspections (vehicle_id, rental_id, inspection_type)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000005', 'delivery');
    raise exception 'TEST_FAIL: duas inspeções de entrega';
  exception when unique_violation then null;
  end;
  begin
    insert into public.inspection_photos (inspection_id, area, storage_path, mime_type, size_bytes)
    values ('11110000-0000-4000-8000-000000000001', 'front', 'outra/pasta/x.jpg', 'image/jpeg', 100);
    raise exception 'TEST_FAIL: foto fora da pasta';
  exception when check_violation then null;
  end;
  begin
    update public.inspections set status = 'completed' where id = '11110000-0000-4000-8000-000000000001';
    raise exception 'TEST_FAIL: concluída sem km';
  exception when raise_exception then
    if sqlerrm not like 'INSPECTION_DATA_REQUIRED%' then raise; end if;
  end;
end $$;

insert into public.inspection_photos (inspection_id, area, storage_path, mime_type, size_bytes)
values ('11110000-0000-4000-8000-000000000001', 'front',
        current_setting('test.jb_company') || '/vehicles/aaaaaaaa-0000-0000-0000-000000000003/inspections/11110000-0000-4000-8000-000000000001/a.jpg',
        'image/jpeg', 1000);

update public.inspections set mileage = 12500, fuel_level = 100, status = 'completed'
 where id = '11110000-0000-4000-8000-000000000001';

do $$
declare r public.rentals;
begin
  select * into r from public.rentals where id = 'eeeeeeee-0000-0000-0000-000000000005';
  assert r.status = 'in_progress', 'inspeção de entrega registra a entrega';
  assert r.start_mileage = 12500 and r.start_fuel_level = 100, 'km e combustível da inspeção';
  assert (select status from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000003') = 'rented', 'veículo alugado';
  assert (select completed_by from public.inspections where id = '11110000-0000-4000-8000-000000000001') = auth.uid(), 'quem concluiu';
  -- evidência imutável
  begin
    update public.inspections set observations = 'alterado' where id = '11110000-0000-4000-8000-000000000001';
    raise exception 'TEST_FAIL: inspeção concluída alterada';
  exception when raise_exception then
    if sqlerrm not like 'INSPECTION_LOCKED%' then raise; end if;
  end;
  begin
    delete from public.inspections where id = '11110000-0000-4000-8000-000000000001';
    raise exception 'TEST_FAIL: inspeção concluída excluída';
  exception when raise_exception then
    if sqlerrm not like 'INSPECTION_LOCKED%' then raise; end if;
  end;
  begin
    delete from public.inspection_photos where inspection_id = '11110000-0000-4000-8000-000000000001';
    raise exception 'TEST_FAIL: foto de evidência excluída';
  exception when raise_exception then
    if sqlerrm not like 'INSPECTION_LOCKED%' then raise; end if;
  end;
end $$;

-- ---------- Inspeção de devolução e avaria nova -----------------------------
insert into public.inspections (id, vehicle_id, rental_id, inspection_type, mileage, fuel_level, checklist)
values ('11110000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000005',
        'return', 12890, 75, '{"front": {"condition": "damaged", "notes": "Amassado no para-choque"}, "left_side": {"condition": "minor"}}');
update public.inspections set status = 'completed' where id = '11110000-0000-4000-8000-000000000002';
do $$ begin
  assert (select status from public.rentals where id = 'eeeeeeee-0000-0000-0000-000000000005') = 'in_progress',
    'a devolução do contrato continua sendo registrada pelo fluxo do contrato';
  assert (select current_mileage from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000003') = 12890, 'km do veículo atualizada';
end $$;

insert into public.damages (id, vehicle_id, rental_id, inspection_id, area, category, severity, description, estimated_cost)
values ('22220000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000005',
        '11110000-0000-4000-8000-000000000002', 'front', 'dent', 'high', 'Amassado no para-choque dianteiro', 380.00);
do $$ begin
  assert (select customer_id from public.damages where id = '22220000-0000-4000-8000-000000000001') = 'cccccccc-0000-0000-0000-000000000001',
    'cliente do contrato associado à avaria';
  assert exists (select 1 from public.dashboard_alerts(50) where kind = 'damage_open'), 'alerta de avaria grave';
  begin
    insert into public.damages (vehicle_id, rental_id, category, description)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005', 'scratch', 'Risco');
    raise exception 'TEST_FAIL: avaria com contrato de outro veículo';
  exception when raise_exception then
    if sqlerrm not like 'DAMAGE_RENTAL_MISMATCH%' then raise; end if;
  end;
end $$;

update public.damages set status = 'resolved', actual_cost = 355.50, repair_shop = 'Taller Martínez'
 where id = '22220000-0000-4000-8000-000000000001';
do $$ begin
  assert (select resolved_at from public.damages where id = '22220000-0000-4000-8000-000000000001') is not null, 'data de resolução automática';
  assert not exists (select 1 from public.dashboard_alerts(50) where kind = 'damage_open'), 'alerta some ao resolver';
end $$;
update public.damages set status = 'in_repair' where id = '22220000-0000-4000-8000-000000000001';
do $$ begin
  assert (select resolved_at from public.damages where id = '22220000-0000-4000-8000-000000000001') is null, 'reaberta limpa a data';
end $$;

-- admin não exclui avaria (RLS: 0 linhas)
delete from public.damages where id = '22220000-0000-4000-8000-000000000001';
do $$ begin
  assert exists (select 1 from public.damages where id = '22220000-0000-4000-8000-000000000001'), 'avaria não excluída pelo admin';
end $$;

-- rascunho pode ser descartado
insert into public.inspections (id, vehicle_id, inspection_type) values ('11110000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'periodic');
delete from public.inspections where id = '11110000-0000-4000-8000-000000000003';
do $$ begin
  assert not exists (select 1 from public.inspections where id = '11110000-0000-4000-8000-000000000003'), 'rascunho descartado';
end $$;

-- isolamento
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert (select count(*) from public.inspections) = 0, 'inspeções isoladas';
  assert (select count(*) from public.damages) = 0, 'avarias isoladas';
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 005_inspections_test'
