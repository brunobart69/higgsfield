-- =====================================================================
-- Testes da migration 0002: convites, cargos, guardas, configurações
-- (executado após 001_core_test.sql, reaproveitando seus usuários)
--   owner  = 1111…  (administrador principal, empresa JB RENT)
--   admin  = 2222…  (administrador)
--   other  = 4444…  (outra empresa)
-- =====================================================================
reset role;
set request.jwt.claim.sub = '';
select set_config('test.jb_company', id::text, false) is not null as ok
from public.companies where name = 'JB RENT' \gset

-- ---------- 1. Convite: usuário criado sem metadados, depois provisionado ----
insert into auth.users (id, email, raw_user_meta_data)
values ('55555555-5555-5555-5555-555555555555', 'convidado@jbrent.es', '{"full_name":"Convidado"}');
do $$ begin
  assert not exists (select 1 from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
    'sem app_metadata não há perfil';
end $$;

update auth.users
   set raw_app_meta_data = jsonb_build_object('company_id', current_setting('test.jb_company'), 'role', 'admin')
 where id = '55555555-5555-5555-5555-555555555555';
do $$ begin
  assert (select role from public.profiles where id = '55555555-5555-5555-5555-555555555555') = 'admin',
    'perfil deve ser criado ao definir app_metadata';
  assert (select full_name from public.profiles where id = '55555555-5555-5555-5555-555555555555') = 'Convidado',
    'nome do convite deve ser copiado';
end $$;

-- alterar app_metadata de quem já tem perfil não muda o cargo
update auth.users
   set raw_app_meta_data = jsonb_build_object('company_id', current_setting('test.jb_company'), 'role', 'owner')
 where id = '55555555-5555-5555-5555-555555555555';
do $$ begin
  assert (select role from public.profiles where id = '55555555-5555-5555-5555-555555555555') = 'admin',
    'app_metadata não pode escalar cargo de perfil existente';
end $$;

-- ---------- 2. Administrador: perfil próprio ------------------------------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

update public.profiles set full_name = 'Segundo Admin', phone = '+34 600 000 000', locale = 'es-ES'
 where id = auth.uid();
do $$ begin
  assert (select full_name from public.profiles where id = auth.uid()) = 'Segundo Admin', 'admin edita o próprio nome';
end $$;

-- não edita o perfil de outro usuário (RLS: 0 linhas)
update public.profiles set full_name = 'Hack' where id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  assert (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111') is distinct from 'Hack',
    'admin não edita perfil alheio';
end $$;

-- não altera o próprio e-mail
do $$ begin
  begin
    update public.profiles set email = 'x@x.com' where id = auth.uid();
    raise exception 'TEST_FAIL: e-mail alterado';
  exception when insufficient_privilege then null;
  end;
end $$;

-- não altera configurações da empresa (RLS: 0 linhas)
update public.companies set name = 'Hack' where id = current_setting('test.jb_company')::uuid;
do $$ begin
  assert (select name from public.companies where id = current_setting('test.jb_company')::uuid) = 'JB RENT',
    'admin não altera a empresa';
end $$;

-- lê, mas não cria taxas adicionais
do $$ begin
  begin
    insert into public.fee_catalog (name_pt, name_es, amount) values ('Cadeirinha', 'Silla infantil', 5);
    raise exception 'TEST_FAIL: admin criou taxa';
  exception when insufficient_privilege then null;
  end;
end $$;

-- histórico de acesso com IP
select public.log_sign_in('Mozilla/5.0 Test', '203.0.113.7, 10.0.0.1');
select public.log_sign_in('Mozilla/5.0 Test', 'não-é-ip');
do $$ begin
  assert (select ip_address from public.activity_logs
           where user_id = auth.uid() and action = 'auth.login' order by id desc offset 1 limit 1) = '203.0.113.7'::inet,
    'IP do primeiro proxy deve ser registrado';
  assert (select ip_address from public.activity_logs
           where user_id = auth.uid() and action = 'auth.login' order by id desc limit 1) is null,
    'IP inválido deve ser ignorado';
end $$;

-- ---------- 3. Administrador principal ------------------------------------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

update public.companies
   set name = 'JB RENT S.L.', tax_id = 'B12345678', vat_rate = 21,
       default_daily_price = 45.00, default_mileage_policy = 'daily', default_mileage_limit_km = 300,
       default_excess_km_price = 0.25, rental_conditions_pt = 'Condições', rental_conditions_es = 'Condiciones'
 where id = app.current_company_id();
do $$ begin
  assert (select name from public.companies where id = app.current_company_id()) = 'JB RENT S.L.', 'dono altera a empresa';
  assert exists (select 1 from public.activity_logs where entity = 'companies' and action = 'update'
                  and changes ? 'name'), 'alteração da empresa auditada';
end $$;

-- política de quilometragem limitada exige limite
do $$ begin
  begin
    update public.companies set default_mileage_limit_km = null where id = app.current_company_id();
    raise exception 'TEST_FAIL: limite nulo aceito';
  exception when check_violation then null;
  end;
end $$;

insert into public.fee_catalog (name_pt, name_es, amount, charge_type)
values ('Condutor adicional', 'Conductor adicional', 6.50, 'per_day');
do $$ begin
  assert (select count(*) from public.fee_catalog) = 1, 'dono cria taxa';
end $$;

-- promover e rebaixar administrador
update public.profiles set role = 'owner' where id = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select role from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 'owner', 'promoção';
end $$;
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

-- não pode se desativar
do $$ begin
  begin
    update public.profiles set is_active = false where id = auth.uid();
    raise exception 'TEST_FAIL: autodesativação aceita';
  exception when insufficient_privilege then null;
  end;
end $$;

-- desativar convidado e reativar
update public.profiles set is_active = false where id = '55555555-5555-5555-5555-555555555555';
update public.profiles set is_active = true where id = '55555555-5555-5555-5555-555555555555';

-- não gerencia perfis de outra empresa
update public.profiles set is_active = false where id = '44444444-4444-4444-4444-444444444444';
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  assert (select is_active from public.profiles where id = '44444444-4444-4444-4444-444444444444'),
    'dono não altera usuário de outra empresa';
end $$;

-- ---------- 4. Último administrador principal -----------------------------
-- (como sistema) promover 2222 a dono e depois tentar remover o único dono restante
update public.profiles set role = 'owner' where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.profiles set is_active = false where id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  begin
    -- agora 2222 é o único dono ativo: o sistema não deixa ficar sem dono
    update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'TEST_FAIL: rebaixamento do único dono';
  exception when insufficient_privilege then null; -- guard: não pode se rebaixar
  end;
end $$;
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  begin
    update public.profiles set is_active = false where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'TEST_FAIL: empresa ficou sem dono ativo';
  exception when raise_exception then
    if sqlerrm not like 'LAST_OWNER%' then raise; end if;
  end;
end $$;
update public.profiles set is_active = true where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

-- ---------- 5. Outra empresa não vê configurações --------------------------
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert (select count(*) from public.fee_catalog) = 0, 'taxas isoladas por empresa';
  assert (select count(*) from public.profiles where company_id = current_setting('test.jb_company')::uuid) = 0,
    'usuários isolados por empresa';
end $$;
reset role;
set request.jwt.claim.sub = '';

\echo '   ok: 002_users_settings_test'

-- ---------- 6. Eventos administrativos -------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.log_event('user.invite', 'profiles', '55555555-5555-5555-5555-555555555555', '{"email":"convidado@jbrent.es"}');
do $$ begin
  assert exists (select 1 from public.activity_logs where action = 'user.invite' and user_id = auth.uid()),
    'evento registrado com o autor';
  begin
    perform public.log_event('vehicle.fake', 'vehicles', 'x', null);
    raise exception 'TEST_FAIL: evento arbitrário aceito';
  exception when invalid_parameter_value then null;
  end;
end $$;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  begin
    perform public.log_event('user.invite', 'profiles', 'x', null);
    raise exception 'TEST_FAIL: usuário sem acesso registrou evento';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set request.jwt.claim.sub = '';
\echo '   ok: 002 eventos'
