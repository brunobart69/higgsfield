-- =====================================================================
-- Testes da migration 0003: veículos, fotos, clientes, RGPD, busca
-- (após 001 e 002; owner = 1111…, admin = 2222…, outra empresa = 4444…)
-- =====================================================================
reset role;
set request.jwt.claim.sub = '';
select set_config('test.jb_company', id::text, false) is not null as ok
from public.companies where name like 'JB RENT%' order by created_at limit 1 \gset

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- ---------- Normalização de matrícula e VIN --------------------------------
insert into public.vehicles (id, brand, model, plate, vin, current_mileage)
values ('aaaaaaaa-0000-0000-0000-000000000003', 'Kia', 'Sportage', '  9012   pqr ', 'u5yh 1234567890123', 10000);
do $$ begin
  assert (select plate from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000003') = '9012 PQR', 'matrícula normalizada';
  assert (select vin from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000003') = 'U5YH1234567890123', 'VIN normalizado';
end $$;

-- ---------- Quilometragem não diminui (admin) --------------------------------
update public.vehicles set current_mileage = 12000 where id = 'aaaaaaaa-0000-0000-0000-000000000003';
do $$ begin
  begin
    update public.vehicles set current_mileage = 11000 where id = 'aaaaaaaa-0000-0000-0000-000000000003';
    raise exception 'TEST_FAIL: km reduzida pelo admin';
  exception when raise_exception then
    if sqlerrm not like 'MILEAGE_DECREASE%' then raise; end if;
  end;
end $$;

-- ---------- Fotos: caminho obrigatório na pasta do veículo, 1 principal -----
insert into public.vehicle_photos (vehicle_id, kind, storage_path, mime_type, size_bytes)
values ('aaaaaaaa-0000-0000-0000-000000000003', 'main',
        current_setting('test.jb_company') || '/vehicles/aaaaaaaa-0000-0000-0000-000000000003/photos/a.jpg', 'image/jpeg', 1000);
do $$ begin
  assert (select main_photo_path from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000003') like '%/photos/a.jpg',
    'foto principal sincronizada na ficha';
  begin
    insert into public.vehicle_photos (vehicle_id, kind, storage_path, mime_type, size_bytes)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'main',
            current_setting('test.jb_company') || '/vehicles/aaaaaaaa-0000-0000-0000-000000000003/photos/b.jpg', 'image/jpeg', 1000);
    raise exception 'TEST_FAIL: duas fotos principais';
  exception when unique_violation then null;
  end;
  begin
    insert into public.vehicle_photos (vehicle_id, kind, storage_path, mime_type, size_bytes)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'exterior', 'outra-empresa/vehicles/x/photos/c.jpg', 'image/jpeg', 1000);
    raise exception 'TEST_FAIL: caminho fora da pasta aceito';
  exception when check_violation then null;
  end;
end $$;
delete from public.vehicle_photos where vehicle_id = 'aaaaaaaa-0000-0000-0000-000000000003';
do $$ begin
  assert (select main_photo_path from public.vehicles where id = 'aaaaaaaa-0000-0000-0000-000000000003') is null,
    'remover a foto principal limpa a miniatura';
end $$;

-- ---------- Clientes: normalização e duplicidade ----------------------------
insert into public.customers (id, customer_type, full_name, id_document_type, id_document_number, email, phone)
values ('cccccccc-0000-0000-0000-000000000002', 'individual', 'Pedro Ruiz', 'dni', '87654321-x', ' PEDRO@Mail.ES ', '+34 611 22 33 44');
do $$ begin
  assert (select id_document_number from public.customers where id = 'cccccccc-0000-0000-0000-000000000002') = '87654321X', 'DNI normalizado';
  assert (select email from public.customers where id = 'cccccccc-0000-0000-0000-000000000002') = 'pedro@mail.es', 'e-mail normalizado';
  begin
    insert into public.customers (customer_type, full_name, id_document_type, id_document_number)
    values ('individual', 'Duplicado', 'dni', '87654321 X');
    raise exception 'TEST_FAIL: documento duplicado';
  exception when unique_violation then null;
  end;
end $$;
insert into public.customers (id, customer_type, company_name, tax_id, representative_name)
values ('cccccccc-0000-0000-0000-000000000003', 'company', 'Transportes Sol S.L.', 'b-87654321', 'Ana Sol');

-- ---------- Documentos de cliente: admin envia, não exclui ------------------
insert into public.customer_documents (id, customer_id, doc_type, title, storage_path, mime_type, size_bytes)
values ('dddddddd-1111-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'id_document', 'DNI',
        current_setting('test.jb_company') || '/customers/cccccccc-0000-0000-0000-000000000002/dni.pdf', 'application/pdf', 5000);
delete from public.customer_documents where id = 'dddddddd-1111-0000-0000-000000000001';
do $$ begin
  assert exists (select 1 from public.customer_documents where id = 'dddddddd-1111-0000-0000-000000000001'),
    'admin não exclui documento pessoal';
  begin
    perform public.anonymize_customer('cccccccc-0000-0000-0000-000000000002');
    raise exception 'TEST_FAIL: admin anonimizou';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Busca global --------------------------------------------------
do $$ begin
  assert exists (select 1 from public.global_search('9012pqr') where kind = 'vehicle'), 'busca por matrícula sem espaço';
  assert exists (select 1 from public.global_search('sportage') where kind = 'vehicle'), 'busca por modelo';
  assert exists (select 1 from public.global_search('87654321') where kind = 'customer'), 'busca por documento';
  assert exists (select 1 from public.global_search('611 22') where kind = 'customer'), 'busca por telefone';
  assert exists (select 1 from public.global_search('transportes') where kind = 'customer'), 'busca por empresa';
  assert not exists (select 1 from public.global_search('%')), 'curingas são literais';
  assert not exists (select 1 from public.global_search('a')), 'mínimo de 2 caracteres';
end $$;

-- ---------- Resumos --------------------------------------------------------
do $$
declare j jsonb;
begin
  j := public.vehicle_financials('aaaaaaaa-0000-0000-0000-000000000001');
  assert (j ->> 'revenue')::numeric = 1000.10, 'receita acumulada do veículo: ' || (j ->> 'revenue');
  assert (j ->> 'expenses')::numeric = 300.05, 'despesa operacional do veículo';
  assert (j ->> 'investment')::numeric = 22000.00, 'investimento separado';
  assert (j ->> 'rentals')::int = 2, 'contratos não cancelados';
  assert (j ->> 'rented_days')::int = 4, 'dias alugados (confirmado 4 dias; reserva não conta)';
  j := public.customer_summary('cccccccc-0000-0000-0000-000000000001');
  assert (j ->> 'rentals')::int = 2, 'aluguéis do cliente';
  assert (j ->> 'billed')::numeric = 180.00, 'faturado ao cliente';
end $$;

-- ---------- Proprietário: km corrigida e anonimização ------------------------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.vehicles set current_mileage = 11500 where id = 'aaaaaaaa-0000-0000-0000-000000000003';

do $$ begin
  begin
    perform public.anonymize_customer('cccccccc-0000-0000-0000-000000000001'); -- tem reservas ativas
    raise exception 'TEST_FAIL: anonimizou cliente com reservas ativas';
  exception when raise_exception then
    if sqlerrm not like 'CUSTOMER_HAS_ACTIVE_RENTALS%' then raise; end if;
  end;
end $$;

do $$
declare paths text[];
begin
  select array_agg(p) into paths from public.anonymize_customer('cccccccc-0000-0000-0000-000000000002') p;
  assert array_length(paths, 1) = 1 and paths[1] like '%/dni.pdf', 'caminhos dos arquivos devolvidos para remoção';
  assert (select full_name from public.customers where id = 'cccccccc-0000-0000-0000-000000000002') = 'Cliente anonimizado', 'nome apagado';
  assert (select id_document_number is null and email is null and phone is null and anonymized_at is not null
            from public.customers where id = 'cccccccc-0000-0000-0000-000000000002'), 'dados pessoais apagados';
  assert not exists (select 1 from public.customer_documents where customer_id = 'cccccccc-0000-0000-0000-000000000002'), 'documentos removidos';
  assert exists (select 1 from public.activity_logs where action = 'customer.anonymized'), 'anonimização registrada';
end $$;

reset role;
set request.jwt.claim.sub = '';
do $$ begin
  assert not exists (select 1 from public.activity_logs where changes::text ilike '%pedro%' or changes::text like '%87654321X%'),
    'o registro de atividades não pode guardar dados pessoais do cliente anonimizado';
  assert exists (select 1 from public.activity_logs where entity = 'customers'
                  and entity_id = 'cccccccc-0000-0000-0000-000000000002' and action = 'insert'),
    'o evento de criação continua registrado (sem os dados)';
end $$;

-- ---------- Storage: exclusão ------------------------------------------------
reset role;
set request.jwt.claim.sub = '';
insert into storage.objects (bucket_id, name, owner_id) values
  ('documents', current_setting('test.jb_company') || '/customers/x/doc-owner.pdf', '11111111-1111-1111-1111-111111111111'),
  ('documents', current_setting('test.jb_company') || '/customers/x/doc-admin.pdf', '22222222-2222-2222-2222-222222222222'),
  ('documents', current_setting('test.jb_company') || '/vehicles/v/photos/p.jpg', '11111111-1111-1111-1111-111111111111');
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
delete from storage.objects where name like '%doc-owner.pdf';
delete from storage.objects where name like '%doc-admin.pdf';
delete from storage.objects where name like '%/vehicles/v/photos/p.jpg';
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  assert exists (select 1 from storage.objects where name like '%doc-owner.pdf'), 'admin não apaga documento pessoal enviado por outro';
  assert not exists (select 1 from storage.objects where name like '%doc-admin.pdf'), 'quem enviou pode desfazer';
  assert not exists (select 1 from storage.objects where name like '%/vehicles/v/photos/p.jpg'), 'equipe remove fotos de veículos';
end $$;

-- ---------- Isolamento ------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert not exists (select 1 from public.global_search('sportage')), 'busca isolada por empresa';
  assert (select count(*) from public.customer_documents) = 0, 'documentos isolados';
  assert (public.vehicle_financials('aaaaaaaa-0000-0000-0000-000000000001') ->> 'revenue')::numeric = 0, 'resumo isolado';
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 003_vehicles_customers_test'
