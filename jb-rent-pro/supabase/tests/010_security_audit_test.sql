-- =====================================================================
-- Auditoria de segurança do banco (executada com todas as migrations)
-- =====================================================================
reset role;
do $$
declare r record; v_bad text := '';
begin
  -- 1) toda tabela do schema public tem RLS ativa
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    v_bad := v_bad || r.relname || ' ';
  end loop;
  assert v_bad = '', 'tabelas sem RLS: ' || v_bad;

  -- 2) o papel anônimo não tem privilégios em nenhuma tabela
  v_bad := '';
  for r in select table_name, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and grantee = 'anon' loop
    v_bad := v_bad || r.table_name || ':' || r.privilege_type || ' ';
  end loop;
  assert v_bad = '', 'privilégios do anon: ' || v_bad;

  -- 3) toda função SECURITY DEFINER fixa o search_path (evita sequestro de objetos)
  v_bad := '';
  for r in select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app') and p.prosecdef
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%') loop
    v_bad := v_bad || r.fn || ' ';
  end loop;
  assert v_bad = '', 'SECURITY DEFINER sem search_path: ' || v_bad;

  -- 4) funções públicas não executáveis pelo anônimo (exceto as do PostgREST internas)
  v_bad := '';
  for r in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
             and p.prorettype <> 'trigger'::regtype
             -- funções de extensões (pgcrypto, btree_gist, pg_trgm) não são do sistema
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    v_bad := v_bad || r.proname || ' ';
  end loop;
  assert v_bad = '', 'funções executáveis pelo anon: ' || v_bad;

  -- 5) auth_user_id_by_email só para o servidor (service_role)
  assert not has_function_privilege('authenticated', 'public.auth_user_id_by_email(text)', 'execute'), 'busca de usuários por e-mail exposta';

  -- 6) tabelas com efeito financeiro/legal não permitem exclusão definitiva
  v_bad := '';
  for r in select unnest(array['rentals', 'financial_transactions', 'insurance_policies', 'documents', 'maintenance_records', 'traffic_fines', 'accidents']) as t loop
    if not exists (select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
                   where c.relname = r.t and tg.tgname like '%no_hard_delete') then
      v_bad := v_bad || r.t || ' ';
    end if;
  end loop;
  assert v_bad = '', 'sem proteção contra exclusão: ' || v_bad;
end $$;
\echo '   ok: 010_security_audit_test'
