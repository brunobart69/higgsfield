-- =====================================================================
-- Testes da migration 0009: calendário, notificações e área do cliente
-- =====================================================================
reset role;
set request.jwt.claim.sub = '';
select set_config('test.jb_company', id::text, false) is not null as ok
from public.companies where name like 'JB RENT%' order by created_at limit 1 \gset
-- usuários do portal (sem company_id no app_metadata → nenhum perfil da equipe)
insert into auth.users (id, email) values
  ('77777777-7777-4777-8777-777777777777', 'maria.cliente@example.es'),
  ('88888888-8888-4888-8888-888888888888', 'pedro.cliente@example.es');
do $$ begin
  assert not exists (select 1 from public.profiles where id in ('77777777-7777-4777-8777-777777777777', '88888888-8888-4888-8888-888888888888')),
    'cliente do portal não ganha perfil da equipe';
end $$;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- ---------- Calendário e disponibilidade --------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from public.calendar_events((now() at time zone 'Europe/Madrid')::date - 400, (now() at time zone 'Europe/Madrid')::date + 400)
   where kind = 'rental' and id = 'eeeeeeee-0000-0000-0000-000000000005';
  assert n = 1, 'contrato no calendário';
  assert exists (select 1 from public.calendar_events((now() at time zone 'Europe/Madrid')::date - 400, (now() at time zone 'Europe/Madrid')::date + 400)
                  where kind = 'insurance_end'), 'vencimento de apólice no calendário';
  -- V3 está alugado agora (contrato 05 em andamento)
  assert (select not available and conflict_contract is not null from public.available_vehicles(now(), now() + interval '2 days')
           where vehicle_id = 'aaaaaaaa-0000-0000-0000-000000000003'), 'veículo alugado indisponível';
  assert exists (select 1 from public.available_vehicles(now() + interval '900 days', now() + interval '903 days') where available),
    'há veículos livres no futuro';
  assert not exists (select 1 from public.available_vehicles(now(), now() - interval '1 day')), 'período inválido não retorna nada';
end $$;

-- ---------- Notificações -----------------------------------------------------
do $$
declare v_new integer; v_unread integer;
begin
  v_new := public.refresh_notifications(interval '0');
  assert v_new > 0, 'alertas viram notificações';
  assert public.refresh_notifications(interval '1 hour') = 0, 'limite de frequência';
  assert public.refresh_notifications(interval '0') = 0, 'sem duplicar';
  v_unread := public.unread_notifications();
  assert v_unread = (select count(*) from public.notifications where resolved_at is null), 'todas não lidas';
  perform public.mark_notifications_read(array[(select id from public.notifications where resolved_at is null order by created_at limit 1)]);
  assert public.unread_notifications() = v_unread - 1, 'uma lida';
  perform public.mark_notifications_read(null);
  assert public.unread_notifications() = 0, 'todas lidas';
end $$;
-- leitura é por usuário
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  assert public.unread_notifications() > 0, 'outro usuário ainda não leu';
end $$;
-- condição resolvida → notificação resolvida
update public.vehicles set itv_due_date = (now() at time zone 'Europe/Madrid')::date + 2 where id = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin perform public.refresh_notifications(interval '0'); end $$;
do $$ begin
  assert exists (select 1 from public.notifications where kind = 'itv_expiring' and entity_id = 'aaaaaaaa-0000-0000-0000-000000000002' and resolved_at is null),
    'ITV vencendo notificada';
end $$;
update public.vehicles set itv_due_date = (now() at time zone 'Europe/Madrid')::date + 400 where id = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$ begin perform public.refresh_notifications(interval '0'); end $$;
do $$ begin
  assert (select resolved_at is not null from public.notifications where kind = 'itv_expiring' and entity_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'ITV renovada resolve a notificação';
end $$;

-- ---------- Área do cliente: ativação ----------------------------------------
insert into public.customer_portal_accounts (user_id, customer_id, email, invited_by)
values ('77777777-7777-4777-8777-777777777777', 'cccccccc-0000-0000-0000-000000000001', ' Maria.Cliente@Example.es ', auth.uid());
do $$ begin
  assert (select email from public.customer_portal_accounts where user_id = '77777777-7777-4777-8777-777777777777') = 'maria.cliente@example.es', 'e-mail normalizado';
  begin
    insert into public.customer_portal_accounts (user_id, customer_id, email)
    values ('22222222-2222-2222-2222-222222222222', 'cccccccc-0000-0000-0000-000000000001', 'x@x.es');
    raise exception 'TEST_FAIL: equipe como cliente do portal';
  exception when raise_exception then
    if sqlerrm not like 'PORTAL_STAFF_CONFLICT%' then raise; end if;
  end;
  begin
    insert into public.customer_portal_accounts (user_id, customer_id, email)
    values ('88888888-8888-4888-8888-888888888888', 'cccccccc-0000-0000-0000-000000000001', 'y@y.es');
    raise exception 'TEST_FAIL: dois acessos para o mesmo cliente';
  exception when unique_violation then null;
  end;
end $$;

-- ---------- Área do cliente: o que o cliente vê ------------------------------
set request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';
do $$
declare j jsonb; n integer;
begin
  -- nenhuma tabela da empresa é visível diretamente
  assert app.current_company_id() is null and not app.is_staff(), 'cliente não é equipe';
  assert not exists (select 1 from public.rentals), 'RLS: contratos invisíveis';
  assert not exists (select 1 from public.customers), 'RLS: clientes invisíveis';
  assert not exists (select 1 from public.financial_transactions), 'RLS: financeiro invisível';
  assert not exists (select 1 from public.notifications), 'RLS: notificações invisíveis';
  assert not exists (select 1 from public.customer_portal_accounts), 'RLS: contas do portal invisíveis';
  j := public.portal_me();
  assert j ->> 'name' is not null and (j ->> 'customer_id')::uuid = 'cccccccc-0000-0000-0000-000000000001', 'próprios dados';
  select count(*) into n from public.portal_rentals();
  assert n >= 1, 'contratos do cliente';
  assert public.portal_owns_rental('eeeeeeee-0000-0000-0000-000000000005'), 'contrato próprio';
  assert exists (select 1 from public.portal_documents()), 'documentos próprios';
  assert exists (select 1 from public.portal_fines() where kind = 'accident'), 'sinistro do cliente';
  begin
    perform public.refresh_notifications(interval '0');
    raise exception 'TEST_FAIL: cliente gerou notificações';
  exception when insufficient_privilege then null;
  end;
end $$;
-- todos os contratos listados pertencem ao cliente (conferido como superusuário)
create temporary table portal_seen as select id from public.portal_rentals();
reset role;
do $$ begin
  assert not exists (select 1 from portal_seen s join public.rentals r on r.id = s.id
                      where r.customer_id <> 'cccccccc-0000-0000-0000-000000000001'), 'somente contratos do próprio cliente';
  assert (select count(*) from portal_seen) = (select count(*) from public.rentals
           where customer_id = 'cccccccc-0000-0000-0000-000000000001' and archived_at is null), 'todos os contratos do cliente';
end $$;
set role authenticated;
set request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';
do $$
declare v_path text; v_req uuid;
begin
  -- documento do próprio cliente: caminho + registro de acesso
  v_path := public.portal_file_path('customer-doc', (select id from public.portal_documents() where kind = 'customer-doc' limit 1));
  assert v_path like '%/customers/cccccccc-0000-0000-0000-000000000001/%', 'arquivo do próprio cliente';
  -- solicitação de reserva gera notificação para a equipe
  v_req := public.portal_request_rental(now() + interval '10 days', now() + interval '13 days', 'SUV automático', 'Viaje a Valencia');
  assert exists (select 1 from public.portal_requests() where id = v_req and status = 'new'), 'solicitação registrada';
  begin
    perform public.portal_request_rental(now() + interval '10 days', now() + interval '9 days', null, null);
    raise exception 'TEST_FAIL: período inválido';
  exception when raise_exception then
    if sqlerrm not like 'INVALID_PERIOD%' then raise; end if;
  end;
end $$;

-- outro cliente sem acesso / acesso de terceiros
set request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';
do $$ begin
  begin
    perform public.portal_me();
    raise exception 'TEST_FAIL: usuário sem conta no portal';
  exception when insufficient_privilege then null;
  end;
  assert not public.portal_owns_rental('eeeeeeee-0000-0000-0000-000000000005'), 'contrato de outro cliente';
end $$;
reset role;
insert into public.customers (id, company_id, customer_type, full_name, email, gdpr_consent_at)
values ('cccccccc-0000-0000-0000-000000000009', current_setting('test.jb_company')::uuid, 'individual', 'Pedro Portal', 'pedro.cliente@example.es', now());
insert into public.customer_portal_accounts (user_id, company_id, customer_id, email)
values ('88888888-8888-4888-8888-888888888888', current_setting('test.jb_company')::uuid, 'cccccccc-0000-0000-0000-000000000009', 'pedro.cliente@example.es');
set role authenticated;
set request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';
do $$ begin
  assert not exists (select 1 from public.portal_rentals() where id = 'eeeeeeee-0000-0000-0000-000000000005'), 'não vê contrato de outro cliente';
  begin
    perform public.portal_file_path('customer-doc', (select id from public.customer_documents limit 1));
    raise exception 'TEST_FAIL: abriu arquivo alheio';
  exception when no_data_found then null;
  end;
end $$;

-- ---------- Equipe trata a solicitação ---------------------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare r public.rental_requests;
begin
  select * into r from public.rental_requests order by created_at desc limit 1;
  assert exists (select 1 from public.notifications where dedupe_key = 'request:' || r.id and resolved_at is null), 'notificação da solicitação';
  update public.rental_requests set status = 'converted', rental_id = 'eeeeeeee-0000-0000-0000-000000000005' where id = r.id;
  assert (select handled_by from public.rental_requests where id = r.id) = '22222222-2222-2222-2222-222222222222', 'quem tratou';
  assert (select resolved_at is not null from public.notifications where dedupe_key = 'request:' || r.id), 'notificação resolvida';
  begin
    update public.rental_requests set pickup_at = now() where id = r.id;
    raise exception 'TEST_FAIL: alterou o pedido do cliente';
  exception when raise_exception then
    if sqlerrm not like 'REQUEST_LOCKED%' then raise; end if;
  end;
end $$;
-- desativar acesso
update public.customer_portal_accounts set disabled_at = now() where user_id = '77777777-7777-4777-8777-777777777777';
set request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';
do $$ begin
  begin
    perform public.portal_me();
    raise exception 'TEST_FAIL: acesso desativado ainda funciona';
  exception when insufficient_privilege then null;
  end;
end $$;
-- isolamento entre empresas
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert not exists (select 1 from public.calendar_events('2000-01-01', '2100-01-01')), 'calendário isolado';
  assert not exists (select 1 from public.available_vehicles(now(), now() + interval '1 day')), 'frota isolada';
  assert not exists (select 1 from public.rental_requests), 'solicitações isoladas';
  assert not exists (select 1 from public.customer_portal_accounts), 'contas isoladas';
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 009_calendar_notifications_portal_test'
