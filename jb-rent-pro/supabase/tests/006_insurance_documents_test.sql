-- =====================================================================
-- Testes da migration 0006: seguros, renovação, despesa automática,
-- documentos com retenção, contrato assinado e alertas
-- =====================================================================
reset role;
set request.jwt.claim.sub = '';
select set_config('test.jb_company', id::text, false) is not null as ok
from public.companies where name like 'JB RENT%' order by created_at limit 1 \gset

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- ---------- Apólice e despesa automática -------------------------------------
insert into public.insurance_policies (id, vehicle_id, insurer, policy_number, coverage_type, start_date, end_date, premium_amount, deductible_amount)
values ('33330000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', ' Mapfre ', 'mp-0045821', 'Todo riesgo con franquicia',
        (now() at time zone 'Europe/Madrid')::date - 340, (now() at time zone 'Europe/Madrid')::date + 10, 1240.00, 300);
do $$
declare f public.financial_transactions;
begin
  assert (select policy_number from public.insurance_policies where id = '33330000-0000-4000-8000-000000000001') = 'MP-0045821', 'nº da apólice normalizado';
  select * into f from public.financial_transactions where insurance_policy_id = '33330000-0000-4000-8000-000000000001';
  assert f.type = 'expense' and f.category = 'insurance' and f.amount = 1240.00 and f.status = 'pending', 'prêmio vira despesa pendente';
  assert f.vehicle_id = 'aaaaaaaa-0000-0000-0000-000000000002', 'despesa ligada ao veículo';
  assert (public.insurance_overview() ->> 'expiring')::int >= 1, 'apólice vencendo em 10 dias';
end $$;

update public.insurance_policies set paid_at = (now() at time zone 'Europe/Madrid')::date - 340, payment_method = 'direct_debit'
 where id = '33330000-0000-4000-8000-000000000001';
do $$ begin
  assert (select status from public.financial_transactions where insurance_policy_id = '33330000-0000-4000-8000-000000000001') = 'paid', 'pagamento do prêmio';
end $$;

-- veículo de outra apólice não pode renovar
do $$ begin
  begin
    insert into public.insurance_policies (vehicle_id, insurer, policy_number, start_date, end_date, renewed_from_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Mapfre', 'X1', current_date, current_date + 365, '33330000-0000-4000-8000-000000000001');
    raise exception 'TEST_FAIL: renovação com outro veículo';
  exception when raise_exception then
    if sqlerrm not like 'RENEWAL_MISMATCH%' then raise; end if;
  end;
end $$;

-- renovação
insert into public.insurance_policies (id, vehicle_id, insurer, policy_number, coverage_type, start_date, end_date, premium_amount, renewed_from_id)
values ('33330000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Mapfre', 'MP-0045821',
        'Todo riesgo con franquicia', (now() at time zone 'Europe/Madrid')::date + 11, (now() at time zone 'Europe/Madrid')::date + 375, 1310.00,
        '33330000-0000-4000-8000-000000000001');
do $$ begin
  assert not exists (select 1 from public.dashboard_alerts(100) where entity_id = '33330000-0000-4000-8000-000000000001'),
    'apólice renovada não gera alerta';
  begin
    insert into public.insurance_policies (vehicle_id, insurer, policy_number, start_date, end_date, renewed_from_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002', 'Mapfre', 'MP-OUTRA', current_date + 11, current_date + 380, '33330000-0000-4000-8000-000000000001');
    raise exception 'TEST_FAIL: duas renovações';
  exception when unique_violation then null;
  end;
end $$;

-- arquivar a renovação anula a despesa
update public.insurance_policies set archived_at = now() where id = '33330000-0000-4000-8000-000000000002';
do $$ begin
  assert (select status from public.financial_transactions where insurance_policy_id = '33330000-0000-4000-8000-000000000002') = 'cancelled',
    'despesa anulada ao arquivar';
  assert exists (select 1 from public.dashboard_alerts(100) where entity_id = '33330000-0000-4000-8000-000000000001' and kind = 'insurance_expiring'),
    'sem renovação ativa, o alerta volta';
end $$;
-- apólice não é excluída (nem pelo admin, nem pelo dono sem autorização)
delete from public.insurance_policies where id = '33330000-0000-4000-8000-000000000002';
do $$ begin
  assert exists (select 1 from public.insurance_policies where id = '33330000-0000-4000-8000-000000000002'), 'apólice preservada';
end $$;

-- ---------- Veículo sem seguro ----------------------------------------------
do $$ begin
  assert exists (select 1 from public.extra_alert_rows() where kind = 'vehicle_uninsured' and entity_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'veículo sem apólice vigente gera alerta';
  assert not exists (select 1 from public.extra_alert_rows() where kind = 'vehicle_uninsured' and entity_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'veículo com apólice vigente não gera alerta';
end $$;

-- ---------- Documentos: retenção e vínculos ---------------------------------
reset role;
set request.jwt.claim.sub = '';
update public.companies set document_retention_years = 6 where id = current_setting('test.jb_company')::uuid;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

insert into public.documents (id, category, title, storage_path, mime_type, size_bytes, vehicle_id, insurance_policy_id, issued_at)
values ('44440000-0000-4000-8000-000000000001', 'insurance_policy', 'Póliza Mapfre 2026',
        current_setting('test.jb_company') || '/vehicles/aaaaaaaa-0000-0000-0000-000000000002/documents/p.pdf', 'application/pdf', 5000,
        'aaaaaaaa-0000-0000-0000-000000000002', '33330000-0000-4000-8000-000000000001', '2026-01-15');
do $$ begin
  assert (select retention_until from public.documents where id = '44440000-0000-4000-8000-000000000001') = '2032-01-15',
    'retenção = emissão + 6 anos';
  begin
    insert into public.documents (category, title, storage_path, mime_type, size_bytes, vehicle_id)
    values ('other', 'x', current_setting('test.jb_company') || '/company/documents/x.pdf', 'application/pdf', 10,
            'aaaaaaaa-0000-0000-0000-000000009999');
    raise exception 'TEST_FAIL: vínculo inexistente';
  exception when foreign_key_violation then null;
  end;
end $$;

-- exclusão definitiva só depois da retenção e só pelo dono
do $$ begin
  begin
    perform public.purge_document('44440000-0000-4000-8000-000000000001');
    raise exception 'TEST_FAIL: admin excluiu documento';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin
    perform public.purge_document('44440000-0000-4000-8000-000000000001');
    raise exception 'TEST_FAIL: excluiu dentro da retenção';
  exception when raise_exception then
    if sqlerrm not like 'RETENTION_ACTIVE%' then raise; end if;
  end;
end $$;
insert into public.documents (id, category, title, storage_path, mime_type, size_bytes, issued_at, retention_until)
values ('44440000-0000-4000-8000-000000000002', 'receipt', 'Recibo antigo', current_setting('test.jb_company') || '/company/general/documents/r.pdf',
        'application/pdf', 100, '2015-01-01', '2021-01-01');
do $$ begin
  assert public.purge_document('44440000-0000-4000-8000-000000000002') like '%/company/general/documents/r.pdf', 'devolve o caminho';
  assert not exists (select 1 from public.documents where id = '44440000-0000-4000-8000-000000000002'), 'excluído após a retenção';
  assert exists (select 1 from public.activity_logs where entity_id = '44440000-0000-4000-8000-000000000002' and action = 'delete'), 'exclusão auditada';
end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- contrato assinado enviado → contrato marcado como assinado
insert into public.documents (category, title, storage_path, mime_type, size_bytes, rental_id)
values ('contract', 'Contrato firmado', current_setting('test.jb_company') || '/rentals/eeeeeeee-0000-0000-0000-000000000005/c.pdf',
        'application/pdf', 9000, 'eeeeeeee-0000-0000-0000-000000000005');
do $$ begin
  assert (select signature_status from public.rentals where id = 'eeeeeeee-0000-0000-0000-000000000005') = 'signed', 'contrato assinado';
end $$;

-- documento de cliente vencendo gera alerta
insert into public.customer_documents (customer_id, doc_type, title, storage_path, mime_type, size_bytes, expires_at)
values ('cccccccc-0000-0000-0000-000000000001', 'driving_licence', 'Permiso de conducir',
        current_setting('test.jb_company') || '/customers/cccccccc-0000-0000-0000-000000000001/documents/l.pdf', 'application/pdf', 1000,
        (now() at time zone 'Europe/Madrid')::date + 5);
do $$ begin
  assert exists (select 1 from public.extra_alert_rows() where kind = 'document_expiring' and entity = 'customer_documents'),
    'alerta de documento do cliente';
  assert (select retention_until from public.customer_documents where title = 'Permiso de conducir') is not null, 'retenção do documento pessoal';
end $$;

-- isolamento
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert (public.insurance_overview() ->> 'active')::int = 0, 'resumo isolado';
  assert not exists (select 1 from public.extra_alert_rows()), 'alertas isolados';
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 006_insurance_documents_test'
